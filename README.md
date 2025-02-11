# AI Project Builder

This tool will from a user prompt generate a boilerplate project. At its current state it will not do anything other than choosing the right libraries while running all the setup commands.

## Features

- Choose the best libraries based on a project briefing
- Handle terminal errors and fix these with commands
- Navigate a CLI by simulating keystrokes
- Write in-line answers for setup commands

## Upcoming features

- After building it will navigate through the project and write some boilerplate code
- Push the project to a new repository on the user's GitHub account.

## Project Setup

1. cp env-template .env
2. Add your openai api key to the .env

3. pnpm i
4. pnpm run generate 'prompt'

-> This will generate a project under the folder /generated-project

## Testing features

1. pnpm run test 'feature-to-test.ts'
