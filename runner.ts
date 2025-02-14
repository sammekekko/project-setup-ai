import dotenv from "dotenv";
import { existsSync, mkdirSync } from "fs";
import path from "path";
import { initial_plan_schema } from "./utils/schemas";
import { TypeOf } from "zod";
import { dockerManager, DockerError } from "./docker/docker";
import { IPty } from "@lydell/node-pty";
import { ProjectErrorHandler } from "./lib/project/error_handler";
import { DEFAULT_CONFIG } from "./config";

/* LIBRARIES */
import {
  generate_core_commands,
  generate_terminal_commands,
} from "./lib/ai/ai";

/* PROMPTS */
import {
  idle_with_no_interactivity,
  interactive_arrow_system_prompt,
  write_inline_system_prompt,
} from "./lib/ai/prompts";

/* UTILS */
import {
  strip_ansi,
  setup_log_regex,
  key_map,
  is_prompt,
  is_interactive_menu,
  get_dependency_names,
} from "./utils/utils";

dotenv.config();

// Project state interface for tracking
interface ProjectState {
  project_dir: string;
  container_name: string;
  current_dir: string;
  core_commands: string[];
  commands: {
    completed: string[];
    failed: string[];
    pending: string[];
  };
}

// Initialize project state
export let projectState: ProjectState = {
  project_dir: "",
  container_name: "",
  current_dir: "",
  core_commands: [],
  commands: {
    completed: [],
    failed: [],
    pending: [],
  },
};

// Initialize error handler
const errorHandler = new ProjectErrorHandler();

// Update the current directory if the command is a "cd" command.
function update_current_dir(command: string): void {
  const trimmed = command.trim();
  const current_dir = projectState.current_dir;
  if (trimmed.startsWith("cd ")) {
    // Extract the directory from the command.
    const target_dir = trimmed.slice(3).trim();
    // Update current_dir: if targetDir is relative, resolve it against current_dir.
    const new_dir = path.resolve(current_dir, target_dir);

    if (existsSync(new_dir)) {
      projectState.current_dir = new_dir;
    } else {
      console.error(
        `cd command failed: Directory "${new_dir}" does not exist.`
      );
    }
  }
}

function run_command(terminal: IPty, input: string) {
  try {
    update_current_dir(input);
    terminal.write(input);
    projectState.commands.pending.push(input);
  } catch (error) {
    errorHandler.onCommandFail(input, error as Error);
    throw error;
  }
}

/**
 * Writes a command to the terminal and logs it.
 */
export async function execute_command_dynamically(
  command: string,
  guide: string,
  terminal: IPty
): Promise<void> {
  let keystrokesActive: boolean = false;
  let latest_output = "";
  let latest_command = command;
  let idle_timer: NodeJS.Timeout | null = null;
  const idle_delay = 2000;

  try {
    run_command(terminal, command + "\r");
    const current_dir = projectState.current_dir;

    const onIdleOutput = async () => {
      if (keystrokesActive) {
        return;
      }

      if (is_interactive_menu(latest_output)) {
        keystrokesActive = true;
        const output_log = `The command\n"${latest_command}\n produced the following interactive prompt:\n"${strip_ansi(
          JSON.stringify(latest_output)
        )}"\nWhat keystrokes should I use?`;
        try {
          const keyResponses = await generate_terminal_commands(
            output_log,
            guide,
            current_dir,
            interactive_arrow_system_prompt
          );
          for (const key of keyResponses) {
            const norm = key.toLowerCase().trim();
            await run_command(terminal, key_map[norm] ?? key);
          }
        } catch (err) {
          console.error("Error obtaining interactive keystroke:", err);
          projectState.commands.failed.push(command);
        } finally {
          keystrokesActive = false;
        }
      } else if (is_prompt(latest_output)) {
        keystrokesActive = true;
        const output_log = `The command:\n'${latest_command}' produced the following prompt:\n"${strip_ansi(
          JSON.stringify(latest_output)
        )}"\\nWhat should I write?`;
        try {
          const responses = await generate_terminal_commands(
            output_log,
            guide,
            current_dir,
            write_inline_system_prompt
          );
          for (const resp of responses) {
            run_command(terminal, resp + "\r");
            latest_command = resp;
          }
        } catch (error) {
          console.error("Error obtaining textual prompt response:", error);
          projectState.commands.failed.push(command);
        } finally {
          keystrokesActive = false;
        }
      } else {
        keystrokesActive = true;
        const output_log = `The command:\n'${latest_command}' produced the following output:\n"${strip_ansi(
          JSON.stringify(latest_output)
        )}"\nWhat should I write?`;
        if (latest_command === "") {
          terminal.kill();
        }
        try {
          const responses = await generate_terminal_commands(
            output_log,
            guide,
            current_dir,
            idle_with_no_interactivity
          );
          if (responses.length == 0 || !responses || responses[0] == "") {
            terminal.kill();
          }
          for (const resp of responses) {
            run_command(terminal, resp + "\r");
            latest_command = resp;
          }
        } catch (error) {
          console.error("Error obtaining textual prompt response:", error);
          projectState.commands.failed.push(command);
        } finally {
          keystrokesActive = false;
        }
      }
      latest_output = "";
    };
    terminal.onData(async (data) => {
      if (keystrokesActive) return;

      // If we detect menu indicators (❯, ●, ○), don't strip ANSI codes yet
      if (is_interactive_menu(data)) {
        // This is menu data - accumulate it as is
        latest_output += data;
      } else {
        // Normal processing for non-menu output
        const output = strip_ansi(data);
        const lines = output.split("\n");
        const filtered = lines.filter((line) => !setup_log_regex.test(line));

        if (filtered.join("\n") != "") {
          latest_output += filtered.join("\n");
        } else {
          latest_output +=
            "```LOGS WERE FILTERED BUT INSTALL SCRIPT ARE RUNNING / ARE DONE```";
        }
      }

      console.log(data);

      if (idle_timer) {
        clearTimeout(idle_timer);
      }
      idle_timer = setTimeout(onIdleOutput, idle_delay);
    });

    // Add timeout handling
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(
          new Error(
            `Command timed out after ${DEFAULT_CONFIG.resourceLimits.timeout}ms`
          )
        );
      }, DEFAULT_CONFIG.resourceLimits.timeout);
    });

    await Promise.race([
      new Promise<void>((resolve) => {
        terminal.onExit((code) => {
          const exitText = `\nCommand "${command}" exited with code ${code.exitCode}\n`;
          console.log(exitText);

          if (code.exitCode === 0) {
            projectState.commands.completed.push(command);
          } else {
            projectState.commands.failed.push(command);
          }

          if (idle_timer) {
            clearTimeout(idle_timer);
          }
          resolve();
        });
      }),
      timeoutPromise,
    ]);
  } catch (error) {
    try {
      await errorHandler.retry(command, 3);
    } catch (retryError) {
      throw retryError;
    }
  }
}

async function main(project_description: string) {
  try {
    // Create the project directory
    const project_dir = path.resolve(process.cwd(), "generated-project");
    let current_dir = projectState.current_dir;

    if (!existsSync(project_dir)) {
      console.log(`Creating project directory at: ${project_dir}`);
      mkdirSync(project_dir, { recursive: true });
    } else {
      console.log(`Project directory already exists at: ${project_dir}`);
    }

    current_dir = project_dir;

    // Initialize project state
    projectState.project_dir = project_dir;
    projectState.current_dir = current_dir;

    // Create and start the Docker container using the new manager
    try {
      projectState.container_name =
        await dockerManager.create_and_start_docker_container(
          project_dir,
          DEFAULT_CONFIG.resourceLimits
        );

      if (
        !(await dockerManager.is_container_healthy(projectState.container_name))
      ) {
        throw new DockerError("Container health check failed");
      }
    } catch (err) {
      await errorHandler.onContainerFail(
        projectState.container_name,
        err as Error
      );
      throw err;
    }

    try {
      const object = (await generate_core_commands(
        project_description
      )) as TypeOf<typeof initial_plan_schema>;
      const core_commands = object.core_commands;
      projectState.core_commands = [...core_commands];
      const guide = object.initial_plan;

      console.log("Guide:", guide);
      console.log("Core Commands:", core_commands);

      function is_install_command(command: string): boolean {
        return command.match(/^(npm|pnpm|yarn|pip) (i|install|add) /) !== null;
      }

      function extract_package_name(command: string): string {
        const matches = command.match(
          /^(?:npm|pnpm|yarn|pip) (?:i|install|add) ([@\w\/-]+)(?:@\S+)?/
        );
        return matches ? matches[1] : "";
      }

      // Execute each command sequentially in the project directory
      for (const command of core_commands) {
        const current_dependencies = await get_dependency_names(current_dir);

        if (
          "error" in current_dependencies &&
          current_dependencies instanceof Error
        ) {
          console.error(current_dependencies.error);
          projectState.commands.failed.push(command);
          continue;
        }

        if (is_install_command(command) && !("error" in current_dependencies)) {
          const package_name = extract_package_name(command);
          const all_deps = [
            ...current_dependencies.dependencies,
            ...current_dependencies.dev_dependencies,
          ];

          if (all_deps.includes(package_name)) {
            console.log(
              `Skipping installation of ${package_name} - already installed`
            );
            projectState.commands.completed.push(command);
            continue;
          }
        }

        // Use dockerManager to spawn terminal
        const terminal = dockerManager.spawn_docker_terminal(
          projectState.container_name
        );
        await execute_command_dynamically(command, guide, terminal);
      }

      console.log("Project setup complete!");
      console.log(
        "Completed commands:",
        projectState.commands.completed.length
      );
      console.log("Failed commands:", projectState.commands.failed.length);
    } catch (error) {
      console.error("Error during command execution:", error);
      throw error;
    } finally {
      // Ensure container cleanup
      if (projectState.container_name) {
        await dockerManager.cleanup_container(projectState.container_name);
      }
    }
  } catch (error) {
    console.error("Error during project setup:", error);
    throw error;
  } finally {
    // Ensure container cleanup after server is closed
    if (projectState.container_name) {
      await dockerManager.cleanup_container(projectState.container_name);
    }
  }
}

// Run if script is called directly
const project_description = process.argv.slice(2).join(" ");
if (!project_description) {
  console.error(
    "Please provide a project description as a command line argument."
  );
  process.exit(1);
}

main(project_description).catch((err) => {
  console.error("Error during project setup:", err);
  process.exit(1);
});
