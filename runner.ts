import dotenv from "dotenv";
import { existsSync, mkdirSync } from "fs";
import path from "path";
import * as os from "os";
import { IPty, spawn } from "@lydell/node-pty";
import { initial_plan_schema } from "./utils/schemas";

/* LIB */
import { generateCoreCommands, generateTerminalCommands } from "./lib/ai";

/* PROMPTS */
import {
  idle_with_no_interactivity,
  interactive_arrow_system_prompt,
  write_inline_system_prompt,
} from "./prompts";

/* UTILS */
import {
  stripANSI,
  setupLogRegex,
  keyMap,
  isPrompt,
  isInteractiveMenu,
} from "./utils/utils";
import { TypeOf } from "zod";

dotenv.config();

let coreCommands: string[] = [];
const ranCommands: string[] = [];
const finishedCoreCommands: string[] = [];

function run_command(terminal, input) {
  terminal.write(input);
  ranCommands.push(input);
}

async function executeCommandDynamic(
  command: string,
  guide: string,
  terminal: IPty,
  projectDir: string
): Promise<void> {
  let keystrokesActive: boolean = false;

  // A variable to store the most recent output (without ANSI codes)
  let latestOutput = "";
  // A timer that will trigger after a given idle period
  let idleTimer: NodeJS.Timeout | null = null;
  // The idle delay (in milliseconds) to consider the output as “settled”
  const IDLE_DELAY = 2000;

  run_command(terminal, command + "\r");

  // This function ensures that interaction cues only will be used if
  // the output has been idle for IDLE_DELAY amount of time
  const onIdleOutput = async () => {
    // Make sure that the AI isn't writing anything during this time
    if (keystrokesActive) return;
    if (isInteractiveMenu(latestOutput)) {
      keystrokesActive = true;
      const output_log = `The command\n"${command}\n produced the following interactive prompt:\n"${latestOutput}"\nWhat keystrokes should I use?`;
      try {
        const keyResponses = await generateTerminalCommands(
          output_log,
          guide,
          interactive_arrow_system_prompt
        );
        for (const key of keyResponses) {
          const norm = key.toLowerCase().trim();
          await run_command(terminal, keyMap[norm] ?? key);
        }
      } catch (err) {
        console.error("Error obtaining interactive keystroke:", err);
      } finally {
        keystrokesActive = false;
      }
    } else if (isPrompt(latestOutput)) {
      keystrokesActive = true;
      const output_log = `The command:\n'${command}' produced the following prompt:\n"${latestOutput}"\nWhat should I write?`;
      try {
        const responses = await generateTerminalCommands(
          output_log,
          guide,
          write_inline_system_prompt
        );
        for (const resp of responses) {
          run_command(terminal, resp + "\r"); // Send response + Enter
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
      const output_log = `The command:\n'${command}' produced the following output:\n"${stripANSI(
        JSON.stringify(latestOutput)
      )}"\nAnd you are currently writing in this directory: ${projectDir}\nWhat should I write?`;
      if (
        latestOutput.length === 0 ||
        !latestOutput ||
        latestOutput === "" ||
        stripANSI(JSON.stringify(latestOutput)) === ""
      ) {
        terminal.kill();
      }
      try {
        const responses = await generateTerminalCommands(
          output_log,
          guide,
          idle_with_no_interactivity
        );
        console.log(
          "The ai decided that this command: ",
          responses[0],
          "was most appropriate for this log: ",
          JSON.stringify(latestOutput)
        );
        if (responses.length == 0 || !responses) {
          /* This will start a new terminal and start executing the next command */
          terminal.kill();
        }
        for (const resp of responses) {
          run_command(terminal, resp + "\r"); // Send response + Enter
          // console.log("Response sent", resp, "for this output:", latestOutput);
        }
      } catch (error) {
        console.error("Error obtaining textual prompt response:", error);
      } finally {
        keystrokesActive = false;
      }
    }

    // Clear the latest output after processing.
    latestOutput = "";
  };

  // Listen to terminal data events.
  terminal.onData(async (data) => {
    // If a keystroke sequence is already active, ignore new data.
    if (keystrokesActive) {
      return;
    }
    const output = stripANSI(data);
    console.log(data);

    const lines = output.split("\n");
    const filtered = lines.filter((line) => !setupLogRegex.test(line));

    if (filtered.join("\n") != "") {
      latestOutput += filtered;
    } else {
      latestOutput =
        "```LOGS WERE FILTERED BUT INSTALL SCRIPT ARE RUNNING / ARE DONE```";
    }

    // Clear any pending idle timer because we just got new output.
    if (idleTimer) {
      clearTimeout(idleTimer);
    }

    idleTimer = setTimeout(onIdleOutput, IDLE_DELAY);
  });

  // Finish when the shell session ends.
  return new Promise<void>((resolve) => {
    terminal.onExit((code) => {
      const exitText = `\nCommand "${command}" exited with code ${code.exitCode}\n`;
      console.log(exitText);
      finishedCoreCommands.push(exitText);
      // Clear the timer if still pending.
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
      resolve();
    });
  });
}

/**
 * Main entry point.
 * Given a project description, this function:
 *   1. Creates a new project directory outside your code.
 *   2. Writes initial files in project folder
 *   3. Asks the AI for a list of terminal commands to set up the project.
 *   4. Executes each command in the project directory.
 *   5. Uses cues to figure out if interactive actions are needed.
 */

function spawn_terminal(projectDir): IPty {
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
  const projectDir = path.resolve(process.cwd(), "generated-project");
  if (!existsSync(projectDir)) {
    console.log(`Creating project directory at: ${projectDir}`);
    mkdirSync(projectDir, { recursive: true });
  } else {
    console.log(`Project directory already exists at: ${projectDir}`);
  }

  const object = (await generateCoreCommands(project_description)) as TypeOf<
    typeof initial_plan_schema
  >;
  coreCommands = object.core_commands;
  const guide = object.initial_plan;

  console.log(guide);
  console.log(coreCommands);

  // Execute each command sequentially in the project directory.
  for (const command of coreCommands) {
    const terminal = spawn_terminal(projectDir);
    await executeCommandDynamic(command, guide, terminal, projectDir);
  }

  console.log("Project setup complete!");
}

// Retrieve the project description from a command line argument.
const projectDescription = process.argv.slice(2).join(" ");
if (!projectDescription) {
  console.error(
    "Please provide a project description as a command line argument."
  );
  process.exit(1);
}

main(projectDescription).catch((err) => {
  console.error("Error during project setup:", err);
  process.exit(1);
});
