// prompts.ts
import { PromptTemplate } from "@langchain/core/prompts";

export const system_prompt = `
You are a helpful assistant that sets up projects based on a given description. All commands will be executed in a terminal. You can do all this flawlessly. Do not repeat commands that you have done earlier, based on ranCommands and coreCommands, such as creating the project twice. Never run any scripts such as 'pnpm run dev' to start a server, this is PROHIBITED. Always skip that step. Also remember that usually when you use commands that create something, such as 'npx create-next-app@latest' you will create a subdirectory with the initited project. Always run the rest of your commands in the created directory, NOT '/generated-app'!
`;

export const initial_plan_prompt = `Provide a list of terminal commands to execute and provide these in an array of strings. These setup-commands will be ran used to initialize and configure the project in the current directory. These will be the coreCommands, and is the 'skeleton' of this project. Use 'npm' when installing packages for JavaScript or TypeScript applications. You will also provide a detailed guide for yourself, which will be used by other AI agents when running commands in /generated-project.
  
  # Example of commands for a 'Next Application with Animations'.
  - 'npx create-next-app@latest'
  - 'pnpm install framer-motion'
  - ... and many more that would be essential for this project

  # Guide structure:
  - Keep it concise
  - Make it clear so that the other AI agents understand the purpose of this project
  - Make a clear list of prohibited commands, such as (pnpm run dev)
  - Make it clear what package manager that will be used (pip, pnpm, or whatever fits best) Always use pnpm over npm

  # Important notes
  - When running setup commands for frameworks or libraries such as vite, there will be options during the setup to choose the right framework (React, Vue, etc). Therefore you should not provide these in the coreCommands list. Never use npm, always choose pnpm over this one.
  `;

export const interactive_arrow_system_prompt = `To navigate through some interactive prompts, you shall return an array of keystroke instructions (e.g. ["down", "enter"]) to select the appropriate option. It is very important that these instructions are in seperate strings and not in a single string.`;

export const write_inline_system_prompt = `To correctly write a response to interactive prompt, you shall most likely provide a single string, such as: 'project-name. Many of these inline prompts contain a placeholder for the input that you will be writing, examples of this are: 'vite-project' in this prompt: '? Project name: › vite-project'. Other prompts like (e.g. 'Are you sure Y/n'), you will have to provide either 'Y' or 'n' depending on what outcome you want.`;

export const idle_with_no_interactivity = `Make sure you analyse the content that you received, because the terminal has either stalled waiting for you to act, or the command has been fully executed. If you receive nothing as the output log, or something that goes in the style of: 'command not found', that means that you are not following the plan and it is very likely that the command was succesfully executed. If the command was successfully executed, you can reply exactly with '' (nothing) to signal the next command to be written. Otherwise provide the right commands.`;

/* NEW AGENT LOGIC */

export const PROJECT_CREATOR_PROMPT = PromptTemplate.fromTemplate(`
You are a project planning expert. Analyze the following project description and determine:
1. Required tech stack
2. Necessary libraries and tools
3. Project structure and features

Project Description: {description}

Provide your analysis in a structured format that can be parsed into a ProjectContext object.
`);

export const PROJECT_SETUP_PROMPT = PromptTemplate.fromTemplate(`
Based on the project context, create a detailed plan for:
1. Files that need to be created
2. Code that needs to be generated
3. Terminal commands that need to be executed

Project Context: {context}

Create a task list that can be distributed to the appropriate agents.
`);

export const CODE_GENERATION_PROMPT = PromptTemplate.fromTemplate(`
Generate or modify code for the following file:
Filename: {filename}
Language: {language}
Goal: {goal}

Current Content (if any):
{content}

Ensure the code follows best practices and meets the specified goal.
`);

export const FILE_CREATION_PROMPT = `
Create a new file with the following specifications:
Filename: {filename}
Directory: {directory}
Content (if needed): {content}

Ensure the file is created in the correct location with appropriate content.
`;

export const TERMINAL_CONTROL_PROMPT = `
Execute the following commands in the terminal:
Working Directory: {directory}
Commands: {commands}

Expected Prompts and Responses:
{expectedPrompts}

Handle any interactive prompts and ensure successful command execution.
`;

export const REVIEW_PROMPT = PromptTemplate.fromTemplate(`
Review the current project state:
Project Context: {context}
Generated Files: {files}
Changes Made: {changes}

Verify that:
1. All required files are created
2. Code meets project requirements
3. Setup commands were successful

Provide feedback and list any necessary corrections.
`);
