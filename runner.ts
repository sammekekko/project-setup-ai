import dotenv from "dotenv";
import { existsSync, mkdirSync } from "fs";
import path from "path";
import * as os from "os";
import { IPty, spawn } from "@lydell/node-pty";
import { initial_plan_schema } from "./utils/schemas";
import { TypeOf } from "zod";

/* LIBRARIES */
import { generate_core_commands, generate_terminal_commands } from "./lib/ai";

/* PROMPTS */
import {
  idle_with_no_interactivity,
  interactive_arrow_system_prompt,
  write_inline_system_prompt,
} from "./lib/prompts";

/* UTILS */
import {
  strip_ansi,
  setup_log_regex,
  key_map,
  is_prompt,
  is_interactive_menu,
} from "./utils/utils";

dotenv.config();

export let core_commands: string[] = [];
export const ran_commands: string[] = [];
export const finished_core_commands: string[] = [];

function run_command(terminal: IPty, input: string) {
  terminal.write(input);
  ran_commands.push(input);
}

async function execute_command_dynamically(
  command: string,
  guide: string,
  terminal: IPty,
  projectDir: string
): Promise<void> {
  let keystrokesActive: boolean = false;

  // A variable to store the most recent output (without ANSI codes)
  let latest_output = "";
  let latest_command = command;
  // A timer that will trigger after a given idle period
  let idle_timer: NodeJS.Timeout | null = null;
  // The idle delay (in milliseconds) to consider the output as “settled”
  const idle_delay = 2000;

  run_command(terminal, command + "\r");

  // This function ensures that interaction cues only will be used if
  // the output has been idle for IDLE_DELAY amount of time
  const onIdleOutput = async () => {
    // Make sure that the AI isn't writing anything during this time
    if (keystrokesActive) return;
    if (is_interactive_menu(latest_output)) {
      keystrokesActive = true;
      const output_log = `The command\n"${latest_command}\n produced the following interactive prompt:\n"${strip_ansi(
        JSON.stringify(latest_output)
      )}"\nWhat keystrokes should I use?`;
      try {
        const keyResponses = await generate_terminal_commands(
          output_log,
          guide,
          projectDir,
          interactive_arrow_system_prompt
        );
        for (const key of keyResponses) {
          const norm = key.toLowerCase().trim();
          await run_command(terminal, key_map[norm] ?? key);
        }
      } catch (err) {
        console.error("Error obtaining interactive keystroke:", err);
      } finally {
        keystrokesActive = false;
      }
    } else if (is_prompt(latest_output)) {
      keystrokesActive = true;
      const output_log = `The command:\n'${latest_command}' produced the following prompt:\n"${strip_ansi(
        JSON.stringify(latest_output)
      )}"\nAnd you are currently writing in this directory: ${projectDir}\nWhat should I write?`;
      try {
        const responses = await generate_terminal_commands(
          output_log,
          guide,
          projectDir,
          write_inline_system_prompt
        );
        for (const resp of responses) {
          run_command(terminal, resp + "\r"); // Send response + Enter
          latest_command = resp;
        }
      } catch (error) {
        console.error("Error obtaining textual prompt response:", error);
      } finally {
        keystrokesActive = false;
      }
    } else {
      /* If the terminal has stopped outputting for two seconds and the 'latestOutput'
       * is not passed by any of the 'isPrompt()', or 'isInteractiveMenu()' checks
       * it will anyways go through by sending the latestOutput awaiting instructions.
       */

      keystrokesActive = true;
      const output_log = `The command:\n'${latest_command}' produced the following output:\n"${strip_ansi(
        JSON.stringify(latest_output)
      )}"\nAnd you are currently writing in this directory: ${projectDir}\nWhat should I write?`;
      if (latest_command === "") {
        terminal.kill();
      }
      try {
        const responses = await generate_terminal_commands(
          output_log,
          guide,
          projectDir,
          idle_with_no_interactivity
        );
        if (responses.length == 0 || !responses || responses[0] == "") {
          /* This will start a new terminal and start executing the next command */
          terminal.kill();
        }
        for (const resp of responses) {
          run_command(terminal, resp + "\r"); // Send response + Enter
          latest_command = resp;
          // console.log("Response sent", resp, "for this output:", latestOutput);
        }
      } catch (error) {
        console.error("Error obtaining textual prompt response:", error);
      } finally {
        keystrokesActive = false;
      }
    }

    // Clear the latest output after processing.
    latest_output = "";
  };

  // Listen to terminal data events.
  terminal.onData(async (data) => {
    // If a keystroke sequence is already active, ignore new data.
    if (keystrokesActive) {
      return;
    }
    const output = strip_ansi(data);
    console.log(data);

    const lines = output.split("\n");
    const filtered = lines.filter((line) => !setup_log_regex.test(line));

    if (filtered.join("\n") != "") {
      latest_output += filtered;
    } else {
      latest_output =
        "```LOGS WERE FILTERED BUT INSTALL SCRIPT ARE RUNNING / ARE DONE```";
    }

    // Clear any pending idle timer because we just got new output.
    if (idle_timer) {
      clearTimeout(idle_timer);
    }

    idle_timer = setTimeout(onIdleOutput, idle_delay);
  });

  // Finish when the shell session ends.
  return new Promise<void>((resolve) => {
    terminal.onExit((code) => {
      const exitText = `\nCommand "${command}" exited with code ${code.exitCode}\n`;
      console.log(exitText);
      finished_core_commands.push(exitText);
      // Clear the timer if still pending.
      if (idle_timer) {
        clearTimeout(idle_timer);
      }
      resolve();
    });
  });
}

/**
 * Main entry point.
 * Given a project description, this function:
 *   1. Creates a new project directory outside your code.
 *   2. Writes initial files in project folder (not yet)
 *   3. Asks the AI for a list of terminal commands to set up the project.
 *   4. Executes each command in the project directory.
 *   5. Uses cues to figure out if interactive actions are needed.
 */

function spawn_terminal(projectDir: string): IPty {
  const shell =
    os.platform() === "win32"
      ? process.env.COMSPEC || "cmd.exe"
      : process.env.SHELL || "/bin/bash";

  return spawn(shell, [], {
    cwd: projectDir,
    name: "project-builder",
    cols: 100,
    rows: 50,
  });
}

async function main(project_description: string) {
  // Create a new directory for the project.
  const project_dir = path.resolve(process.cwd(), "generated-project");
  if (!existsSync(project_dir)) {
    console.log(`Creating project directory at: ${project_dir}`);
    mkdirSync(project_dir, { recursive: true });
  } else {
    console.log(`Project directory already exists at: ${project_dir}`);
  }

  const object = (await generate_core_commands(project_description)) as TypeOf<
    typeof initial_plan_schema
  >;
  core_commands = object.core_commands;
  const guide = object.initial_plan;

  console.log(guide);
  console.log(core_commands);

  // Execute each command sequentially in the project directory.
  for (const command of core_commands) {
    const terminal = spawn_terminal(project_dir as string);
    await execute_command_dynamically(command, guide, terminal, project_dir);
  }

  console.log("Project setup complete!");
}

// Retrieve the project description from a command line argument.
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
