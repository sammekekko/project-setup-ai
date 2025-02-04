import { z } from "zod";

export const initial_plan_schema = z.object({
  core_commands: z
    .array(
      z
        .string()
        .describe(
          "Command or answer that will be outputted in the terminal exactly as written"
        )
    )
    .describe("An array of commands/answers to be executed in the terminal"),
  initial_plan: z
    .string()
    .describe(
      "An indepth guide for yourself that will be used so that every core-command will be executed flawlessly. Make sure to provide as much information as needed, but do not hallucinate and generate random information. Keep in concise."
    ),
});

export const terminal_input_schema = z.object({
  terminal_input: z
    .array(
      z
        .string()
        .describe(
          "Command or answer that will be outputted in the terminal exactly as written"
        )
    )
    .describe("An array of commands/answers to be executed in the terminal"),
});
