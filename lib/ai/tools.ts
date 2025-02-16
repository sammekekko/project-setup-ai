import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { dockerManager } from "../../docker/docker"; // adjust this path as needed
import * as fs from "fs/promises";
import * as path from "path";
import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { IPty } from "@lydell/node-pty";
import {
  idle_with_no_interactivity,
  interactive_arrow_system_prompt,
  write_inline_system_prompt,
} from "./prompts";
import {
  strip_ansi,
  setup_log_regex,
  key_map,
  is_prompt,
  is_interactive_menu,
  is_shell_prompt,
} from "../../utils/utils";
import { get_context } from "./embeddings/embedding_manager";
import { existsSync } from "fs";

// Re-use the command schema from before.
const CommandSchema = z.object({
  commands: z.array(
    z.object({
      command: z.string(),
    })
  ),
  working_directory: z.string(),
});

const ReviewSchema = z.object({
  isComplete: z.boolean(),
  issues: z.array(z.string()),
  suggestions: z.array(z.string()),
  missingComponents: z.array(z.string()),
  qualityChecks: z.object({
    codeQuality: z.boolean(),
    projectStructure: z.boolean(),
    dependencies: z.boolean(),
  }),
  nextActions: z.array(
    z.object({
      type: z.enum(["GENERATE_CODE", "CREATE_FILE", "RUN_COMMAND"]),
      description: z.string(),
      priority: z.enum(["high", "medium", "low"]),
      command: z.string().optional(),
      filename: z.string().optional(),
      content: z.string().optional(),
      directory: z.string().optional(),
    })
  ),
});

const ProjectFilesSchema = z.object({
  directory: z.string(),
  fileTypes: z.array(z.string()).optional(),
});

const CodeValidationSchema = z.object({
  code: z.string(),
  language: z.string(),
});

const WriteCodeSchema = z.object({
  filename: z.string(),
  entire_path: z
    .string()
    .describe(
      "The entire path including the working directory, and not the filename"
    ),
  code: z.string(),
});

const LibraryContextSchema = z.object({
  query: z.string(),
});

let DEFAULT_CONTAINER = "default_container";
export function setDefaultContainer(containerName: string) {
  DEFAULT_CONTAINER = containerName;
}

// Schemas for interactive terminal responses
const interactiveMenuSchema = z.object({
  keystrokes: z.array(z.string()),
});
const terminalCommandSchema = z.object({
  terminal_input: z.string(),
});

export const get_library_context = new DynamicStructuredTool({
  name: "get_library_context",
  description: "Retrieves relevant library context from embeddings",
  schema: LibraryContextSchema,
  func: async ({ query }) => {
    try {
      // This just calls the embedding manager's get_context function
      const context = await get_context(query);
      return JSON.stringify({ context });
    } catch (error: any) {
      throw new Error(`Error retrieving library context: ${error.message}`);
    }
  },
});

export const validate_code = new DynamicStructuredTool({
  name: "validate_code",
  description: "Validates code for basic syntax",
  schema: CodeValidationSchema,
  func: async ({ code, language }) => {
    try {
      if (language === "typescript" || language === "javascript") {
        // Basic syntax validation
        new Function(code);
        return JSON.stringify({ isValid: true });
      }
      return JSON.stringify({ isValid: true }); // For other languages
    } catch (error: any) {
      return JSON.stringify({
        isValid: false,
        error: error.message,
      });
    }
  },
});

export const write_code = new DynamicStructuredTool({
  name: "write_code",
  description: "Writes code to a specified file",
  schema: WriteCodeSchema,
  func: async ({ filename, entire_path, code }) => {
    try {
      // const BASE_DIR = "/generated-project";
      const fullPath = path.join(entire_path, filename);
      console.log(fullPath);

      // Ensure directory exists
      await fs.mkdir(path.dirname(fullPath), { recursive: true });

      // Write the code
      await fs.writeFile(fullPath, code, "utf8");
      return `Successfully wrote code to: "${fullPath}"`;
    } catch (error: any) {
      throw new Error(`Error writing code to "${filename}": ${error.message}`);
    }
  },
});

export const get_project_files = new DynamicStructuredTool({
  name: "get_project_files",
  description: "Retrieves the content of all relevant project files",
  schema: ProjectFilesSchema,
  func: async ({
    directory,
    fileTypes = ["txt", "md", "js", "ts", "json", "yaml", "yml", "ini", "conf"],
  }) => {
    const fileContents: { [key: string]: string } = {};

    try {
      // Recursively get all files in directory
      const getFiles = async (dir: string): Promise<string[]> => {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        const files = await Promise.all(
          entries.map(async (entry) => {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              if (entry.name === "node_modules") return [];
              return getFiles(fullPath);
            }
            // Check if file matches any of the file types
            const ext = path.extname(entry.name).slice(1);
            if (fileTypes.includes(ext)) {
              return [fullPath];
            }
            return [];
          })
        );

        return files.flat();
      };

      // Get all matching files
      const files = await getFiles(directory);

      // Read content of each file
      await Promise.all(
        files.map(async (file) => {
          const content = await fs.readFile(file, "utf8");
          fileContents[path.relative(directory, file)] = content;
        })
      );

      return JSON.stringify(fileContents);
    } catch (error: any) {
      throw new Error(`Error reading project files: ${error.message}`);
    }
  },
});

export const analyze_project = new DynamicStructuredTool({
  name: "analyze_project",
  description: "Analyzes project state and provides review feedback",
  schema: z.object({
    context: z.any(),
    files: z.string(), // JSON string of file contents
  }),
  func: async ({ context, files }) => {
    const model = openai("gpt-4o-2024-11-20");

    try {
      const result = await generateObject({
        model,
        system: `You are a thorough code reviewer and project validator.
                For each issue, provide specific nextActions with these properties:
                - For RUN_COMMAND: include 'command' property with the exact command to run
                - For CREATE_FILE: include 'filename', 'directory', and optionally 'content'
                - For GENERATE_CODE: include 'filename', 'content' as properties
                Format all nextActions with practical, executable details.`,
        prompt: `Review the current project state:
                Project Context: ${JSON.stringify({
                  context,
                  files: JSON.parse(files),
                })}
                
                Provide a comprehensive review focusing on completeness and quality.
                Each nextAction must include specific details for execution.`,
        schema: ReviewSchema,
        schemaName: "project-review-schema",
        schemaDescription: "Project review analysis with detailed next actions",
      });

      return JSON.stringify(result.object);
    } catch (error: any) {
      throw new Error(`Error analyzing project: ${error.message}`);
    }
  },
});

// Basic File Operation Tools
export const read_file_tool = new DynamicStructuredTool({
  name: "read_file",
  description: "Reads content from a specified file",
  schema: z.object({
    filename: z.string(),
    relative_path: z.string(),
    working_directory: z.string(),
  }),
  func: async ({ filename, relative_path, working_directory }) => {
    try {
      const fullPath = path.join(working_directory, relative_path, filename);
      const content = await fs.readFile(fullPath, "utf8");
      return content;
    } catch (error: any) {
      throw new Error(`Error reading file "${filename}": ${error.message}`);
    }
  },
});

export const write_file_tool = new DynamicStructuredTool({
  name: "write_file",
  description: "Writes content to a specified file",
  schema: z.object({
    filename: z.string(),
    write_path: z
      .string()
      .describe(
        "The entire path including the working directory, and not the filename"
      ),
    content: z.string(),
  }),
  func: async ({ filename, write_path, content }) => {
    try {
      const fullPath = path.join(write_path, filename);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, "utf8");
      return `Successfully wrote to file: "${fullPath}"`;
    } catch (error: any) {
      throw new Error(`Error writing to file "${filename}": ${error.message}`);
    }
  },
});

export const list_files_tool = new DynamicStructuredTool({
  name: "list_files",
  description: "Lists all files in a directory",
  schema: z.object({
    relative_path: z
      .string()
      .describe("The entire path including the working directory."),
  }),
  func: async ({ relative_path }) => {
    try {
      const generated_project_path = path.join(
        process.cwd(),
        "generated-project"
      );
      const full_path = path.join(generated_project_path, relative_path);
      const files = await fs.readdir(full_path, { recursive: true });
      return JSON.stringify(files, null, 2);
    } catch (error: any) {
      throw new Error(
        `Error listing files in "${relative_path}": ${error.message}`
      );
    }
  },
});

/**
 * Tool: run_commands
 *
 * This tool implements the exact dynamic command execution logic
 * from TerminalControlAgent. It spawns a terminal in DEFAULT_CONTAINER,
 * writes the command, listens for interactive prompts, and handles
 * idle output exactly as in the original implementation.
 */

export const command_tool = new DynamicStructuredTool({
  name: "run_commands",
  description:
    "Runs terminal commands using the dynamic interactive execution logic in the default container",
  schema: CommandSchema,
  func: async ({ commands, working_directory }) => {
    const results: string[] = [];
    // Create a model instance for dynamic interaction
    const model = openai("gpt-4o-2024-11-20");
    let current_dir = working_directory;

    function run_terminal_command(command: string, terminal: IPty) {
      update_current_dir(command);
      terminal.write(command);
    }

    function update_current_dir(command: string): void {
      const commands = command.split("&&").map((cmd) => cmd.trim());
      const base_url = path.join(process.cwd(), "generated-project");
      for (const cmd of commands) {
        if (cmd.startsWith("cd ")) {
          const target_dir = cmd.slice(3).trim();
          // Use path.join to maintain the working_directory context
          if (existsSync(path.join(base_url, target_dir))) {
            current_dir = "/generated-project/" + target_dir;
          } else {
            console.error(
              `cd command failed: Directory "${target_dir}" does not exist.`
            );
          }
        }
      }
    }

    // Define the dynamic command execution function exactly as in TerminalControlAgent.
    async function executeDynamicCommand(
      command: string,
      terminal: IPty
    ): Promise<void> {
      let keystrokesActive: boolean = false;
      let latestOutput = "Beginning of output";
      let latestCommand = command;
      let idleTimer: NodeJS.Timeout | null = null;
      const idleDelay = 2000;

      const onIdleOutput = async () => {
        if (keystrokesActive) return;
        const strippedOutput = strip_ansi(latestOutput);

        if (is_interactive_menu(latestOutput)) {
          keystrokesActive = true;
          const outputLog = `The command\n"${latestCommand}\n produced the following interactive prompt:\n"${strip_ansi(
            JSON.stringify(latestOutput)
          )}"\nWhat keystrokes should I use?\nAnswer with nothing if the command has finished running, e.g ('')`;

          try {
            const result = await generateObject({
              model,
              system:
                interactive_arrow_system_prompt +
                ` You are working in this directory: ${current_dir}`,
              prompt: outputLog,
              schema: interactiveMenuSchema,
              schemaName: "interactive-menu-schema",
              schemaDescription:
                "Keystrokes for interactive terminal menu navigation",
            });

            console.log("working in interactive systme");
            console.log(result.object.keystrokes);

            if (
              !result.object.keystrokes.length ||
              result.object.keystrokes[0] == ""
            ) {
              terminal.kill();
              return;
            }

            for (const key of result.object.keystrokes) {
              const normalizedKey = key.toLowerCase().trim();
              run_terminal_command(key_map[normalizedKey] ?? key, terminal);
            }
          } catch (err) {
            console.error("Error handling interactive menu:", err);
            throw err;
          } finally {
            keystrokesActive = false;
          }
        } else if (is_prompt(latestOutput)) {
          keystrokesActive = true;
          const outputLog = `The command:\n'${latestCommand}' produced the following prompt:\n"${strip_ansi(
            JSON.stringify(latestOutput)
          )}"\nWhat should I write?\nAnswer with nothing if the command has finished running, e.g ('')`;

          try {
            const result = await generateObject({
              model,
              system:
                write_inline_system_prompt +
                ` You are working in this directory: ${current_dir}`,
              prompt: outputLog,
              schema: terminalCommandSchema,
              schemaName: "terminal-command-schema",
              schemaDescription: "Terminal command input",
            });

            const terminal_input = result.object.terminal_input;
            console.log("FROM AI: ", terminal_input);
            if (!terminal_input.length || terminal_input == "") {
              terminal.kill();
              return;
            }

            run_terminal_command(terminal_input + "\r", terminal);
            latestCommand = terminal_input;
          } catch (error) {
            console.error("Error handling prompt:", error);
            throw error;
          } finally {
            keystrokesActive = false;
          }
        } else if (is_shell_prompt(strippedOutput, latestCommand)) {
          console.log("Command completed (shell prompt detected)");
          terminal.kill();
          return;
        } else {
          keystrokesActive = true;
          const outputLog = `The command:\n'${latestCommand}' produced the following output:\n"${strip_ansi(
            JSON.stringify(latestOutput)
          )}"\nWhat should I write?\nAnswer with nothing if the command has finished running, e.g ('')`;

          try {
            const result = await generateObject({
              model,
              system:
                idle_with_no_interactivity +
                ` You are working in this directory: ${current_dir}`,
              prompt: outputLog,
              schema: terminalCommandSchema,
              schemaName: "terminal-command-schema",
              schemaDescription: "Terminal command input",
            });

            const terminal_input = result.object.terminal_input;
            if (!terminal_input.length || terminal_input == "") {
              console.log("Killing here");
              terminal.kill();
              return;
            }

            run_terminal_command(terminal_input + "\r", terminal);
            latestCommand = terminal_input;
          } catch (error) {
            console.error("Error handling idle output:", error);
            throw error;
          } finally {
            keystrokesActive = false;
          }
        }
        latestOutput = "";
      };

      run_terminal_command(command + "\r", terminal);

      terminal.onData((data) => {
        console.log(data);
        if (keystrokesActive) return;

        if (is_interactive_menu(data)) {
          latestOutput += data;
        } else {
          const output = strip_ansi(data);
          const lines = output.split("\n");
          const filtered = lines.filter((line) => !setup_log_regex.test(line));

          if (filtered.join("\n") !== "") {
            latestOutput += filtered.join("\n");
          } else {
            latestOutput +=
              "```LOGS WERE FILTERED BUT INSTALL SCRIPT ARE RUNNING / ARE DONE```";
          }
        }

        if (idleTimer) {
          clearTimeout(idleTimer);
        }
        idleTimer = setTimeout(onIdleOutput, idleDelay);
      });

      let timeoutId: NodeJS.Timeout;
      let isCommandComplete = false;

      timeoutId = setTimeout(() => {
        if (!isCommandComplete) {
          console.log("Command timed out");
          terminal.kill();
          throw new Error(`Command timed out after ${60000 * 2}ms`);
        }
      }, 60000 * 2);

      await new Promise<void>((resolve) => {
        terminal.onExit((code) => {
          const exitText = `\nCommand "${command}" exited with code ${code.exitCode}\n`;
          console.log(exitText);

          if (idleTimer) {
            clearTimeout(idleTimer);
          }
          isCommandComplete = true;
          clearTimeout(timeoutId);
          resolve();
        });
      });
    }

    // Process each command exactly as in TerminalControlAgent.executeCommand
    for (const { command: originalCommand } of commands) {
      // Adjust npm init if needed.
      let command = originalCommand;

      // Spawn a terminal in the default container.
      const terminal = dockerManager.spawn_docker_terminal(DEFAULT_CONTAINER);
      try {
        await executeDynamicCommand(command, terminal);
        results.push(`Executed: "${command}" in "${DEFAULT_CONTAINER}"`);
      } catch (error: any) {
        results.push(
          `Error executing "${command}" in "${DEFAULT_CONTAINER}": ${error.message}`
        );
      } finally {
        terminal.kill();
      }
    }
    return {
      output: results.join("\n"),
      working_directory: current_dir,
    };
  },
});

export const tools = {
  // File operations
  read_file: read_file_tool,
  write_file: write_file_tool,
  list_files: list_files_tool,
  get_project_files,
  analyze_project,
  validate_code,
  write_code,
  get_library_context,

  // Terminal operations
  execute_command: command_tool,
};
