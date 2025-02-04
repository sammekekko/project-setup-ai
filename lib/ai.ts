import { openai } from "@ai-sdk/openai";
import { generateObject, AISDKError, LanguageModelV1 } from "ai";
import { system_prompt, initial_plan_prompt } from "../prompts";
import { initial_plan_schema, terminal_input_schema } from "../utils/schemas";

const model: LanguageModelV1 = openai("gpt-4o-2024-11-20");

export async function generateCoreCommands(input: string): Promise<object> {
  try {
    const result = await generateObject({
      model,
      system: `${system_prompt}\n${initial_plan_prompt}`,
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

export async function generateTerminalCommands(
  input: string,
  guide: string,
  prompt_injection: string
): Promise<string[]> {
  try {
    const object = await generateObject({
      model,
      system: `${system_prompt}\nTake this guide into consideration when writing commands:\n'${guide}'\nYour mission is to finish the inputted command's execution by following it's instructions or interactive prompts. ${prompt_injection}`,
      prompt: input,
      schema: terminal_input_schema,
      schemaName: "terminal-in-line-command-schema",
      schemaDescription:
        "An array of strings that will be executed in the terminal",
    });
    let commands = object.object.terminal_input || [];

    return commands;
  } catch (error) {
    console.error("Error generating AI commands:", error);
    throw new AISDKError({
      name: error.name,
      message: error.message,
    });
  }
}
