import { openai } from "@ai-sdk/openai";
import { CoreMessage, streamText } from "ai";
import dotenv from "dotenv";
import { spawn } from "child_process";
import * as readline from "node:readline/promises";

dotenv.config();

// Create a readline interface for logging (and for optional manual input)
const terminal = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Set up the conversation history with a system prompt that tells the AI what its role is.
const messages: CoreMessage[] = [
  {
    role: "system",
    content:
      "You are a helpful assistant that sets up projects based on a given description. " +
      "You generate a list of terminal commands to create, install, and configure a project. " +
      "When a running command outputs an interactive prompt (for example, 'Are you sure you want to do this Y/n'), " +
      "you are also responsible for providing the correct input for that prompt.",
  },
];

/**
 * Sends a message to the AI (adding it to the conversation history) and returns the AI’s response.
 */
async function askAI(userInput: string): Promise<string> {
  messages.push({ role: "user", content: userInput });
  process.stdout.write(`\n[AI Prompt]: ${userInput}\n\nAssistant: `);
  const result = streamText({
    model: openai("gpt-4o-mini"),
    messages,
  });
  let fullResponse = "";
  for await (const delta of result.textStream) {
    fullResponse += delta;
    process.stdout.write(delta);
  }
  messages.push({ role: "assistant", content: fullResponse });
  process.stdout.write("\n");
  return fullResponse.trim();
}

/**
 * Executes a given shell command. If the process outputs something that looks like an interactive prompt
 * (e.g. includes "Y/n"), it will ask the AI for what to answer and send that answer to the command’s stdin.
 */
async function executeCommand(command: string): Promise<void> {
  console.log(`\nExecuting: ${command}\n`);

  // Spawn the command in a shell with piped stdio
  const child = spawn(command, {
    shell: true,
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Listen to stdout data.
  child.stdout.on("data", async (data: Buffer) => {
    const text = data.toString();
    process.stdout.write(text);
    // Check for a simple interactive prompt pattern (adjust this as needed)
    if (text.includes("Y/n") || text.includes("y/n")) {
      // Ask the AI what to do when a prompt appears.
      const response = await askAI(
        `The command "${command}" produced the prompt:\n"${text.trim()}"\nWhat should I answer?`
      );
      // Write the AI’s answer to the process stdin.
      child.stdin.write(response + "\n");
    }
  });

  // Also listen to stderr data.
  child.stderr.on("data", async (data: Buffer) => {
    const text = data.toString();
    process.stderr.write(text);
    if (text.includes("Y/n") || text.includes("y/n")) {
      const response = await askAI(
        `The command "${command}" produced an error prompt:\n"${text.trim()}"\nWhat should I answer?`
      );
      child.stdin.write(response + "\n");
    }
  });

  // Return a promise that resolves when the command finishes.
  return new Promise((resolve, reject) => {
    child.on("close", (code) => {
      console.log(`\nCommand "${command}" finished with exit code ${code}\n`);
      resolve();
    });
    child.on("error", (err) => {
      console.error(`Error executing command "${command}": ${err}`);
      reject(err);
    });
  });
}

/**
 * Main entry point: given a project description, ask the AI to generate a list of terminal commands
 * and execute them one by one.
 */
async function main(project_description: string) {
  // Ask the AI for a plan. We instruct it to return one command per line (no extra explanation).
  const prompt =
    `Set up a project with the following description: "${project_description}". ` +
    "Provide a list of terminal commands to execute (one per line) that will initialize and configure the project. " +
    "Do not include any extra explanation. Always begin by creating a new directory for the project.";
  const plan = await askAI(prompt);

  // Split the AI's response into individual commands (assumes one command per line).
  const commands = plan
    .split("\n")
    .map((cmd) => cmd.trim())
    .filter((cmd) => cmd !== "");

  // Execute each command sequentially.
  for (const command of commands) {
    await executeCommand(command);
  }

  console.log("Project setup complete!");
}

// Retrieve the project description from a command line argument.
const projectDescription = process.argv[2];
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
