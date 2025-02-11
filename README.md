# AI Project Builder

This tool will from a user prompt generate a boilerplate project. At its current state it will not do anything other than choosing the right libraries while running all the setup commands.

## Features

- AI choosing the best libraries based on a project briefing (RAG)
- Handle terminal errors and fix these with commands
- Navigate a CLI by simulating keystrokes
- Write in-line answers for setup commands

## Strategy

- It uses a buffer technique to detect whether the output of the console is done outputting, the buffer **idle_delay** is configurable in _runner.ts_
- Multiple agents specialized at different tasks. Current agents' tasks: **Generating Core Setup Commands**, **Generating terminal commands that are required at runtime**
- Using embeddings to create a RAG-model that provides the most compatible tools from a vector store based on _/resources/libraries.txt_

## Upcoming features

- After building it will navigate through the project and write some boilerplate code
- Push the project to a new repository on the user's GitHub account.

## Project Setup

### Setup the enviornment variables

1. cp env-template .env
2. Add your openai api key to the .env

### Install packages with pnpm

3. pnpm i

### Generate the database and vector store

4. Add more knowledge to /resources/libraries.txt if needed
5. pnpm run embeddings:generate

### Run the script

6. pnpm run start 'Generate a ....'

-> This will generate a project under the folder /generated-project

## Testing features

To test every feature for debugging you can use the _pnpm run test 'src'_ command, which will test every function with sample data

### Examples

- pnpm run test utils.ts
- pnpm run test lib/ai/ai.ts
