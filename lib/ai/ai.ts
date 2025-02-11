import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";

import { generateObject, AISDKError, LanguageModelV1 } from "ai";
import { system_prompt, initial_plan_prompt } from "./prompts";
import {
  initial_plan_schema,
  terminal_input_schema,
} from "../../utils/schemas";
import { ran_commands } from "../../runner";
import {
  get_dependency_names,
  prepare_dependency_names,
} from "../../utils/utils";
import * as fs from "fs";
import * as path from "path";
import { get_context } from "./embeddings/embedding_manager";

const model: LanguageModelV1 = openai("gpt-4o-2024-11-20");
// const model = google("learnlm-1.5-pro-experimental");

export async function generate_core_commands(input: string): Promise<object> {
  const library_context = await get_context(input);
  console.log(library_context);

  try {
    const result = await generateObject({
      model,
      system: `${system_prompt}\n${initial_plan_prompt}\nLibraries that are relevant for this project: ${library_context} `,
      prompt: input,
      schema: initial_plan_schema,
      schemaName: "initial-plan-schema",
      schemaDescription:
        "Initial plan to setup a project, includes commands and a worded plan",
    });

    return result.object as object;
  } catch (error) {
    console.error("Error generating core commands with ai:", error);
    throw new AISDKError({
      name: error.name,
      message: error.message,
    });
  }
}

export async function generate_terminal_commands(
  input: string,
  guide: string,
  project_directory: string,
  prompt_injection: string
): Promise<string[]> {
  const all_dependencies:
    | {
        dependencies: string[];
        dev_dependencies: string[];
      }
    | { error: string | Error } = await get_dependency_names(
    path.join(project_directory)
  );
  const dependency_output = prepare_dependency_names(all_dependencies);
  console.log(project_directory);

  try {
    const object = await generateObject({
      model,
      system: `\n'${guide}'\nYour mission is to finish the inputted command's execution by following it's instructions or interactive prompts. ${prompt_injection}These are the commands that you have ran before this:\n${ran_commands}\nNever repeat the same commands\n${dependency_output}'`,
      prompt: input,
      schema: terminal_input_schema,
      schemaName: "terminal-in-line-command-schema",
      schemaDescription:
        "An array of strings that will be executed in the terminal",
    });
    let commands = object.object.terminal_input || [];

    async function log_commands(
      input: string,
      commands: string[]
    ): Promise<void> {
      const logDirPath = path.dirname(process.cwd());
      const logFilePath = path.join(logDirPath, "project-setup-ai/log.txt");

      const logEntry = `Input: ${input}\nCommands: ${commands.join(", ")}\n\n`;

      await fs.promises.appendFile(logFilePath, logEntry, "utf8");
    }

    log_commands(input, commands);

    return commands;
  } catch (error) {
    console.error("Error generating AI commands:", error);
    throw new AISDKError({
      name: error.name,
      message: error.message,
    });
  }
}
