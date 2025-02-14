import { projectState } from "../../runner";
import { dockerManager } from "../../docker/docker";
import { execute_command_dynamically } from "../../runner";
import { SECURITY_CONFIG } from "../../config";

interface ErrorHandler {
  onCommandFail: (command: string, error: Error) => Promise<void>;
  onContainerFail: (containerName: string, error: Error) => Promise<void>;
  retry: (command: string, maxAttempts: number) => Promise<void>;
}

// Add security validation to run_command
export function validate_command(command: string): boolean {
  const commandParts = command.trim().split(" ");
  const baseCommand = commandParts[0];

  if (SECURITY_CONFIG.blockedCommands.includes(baseCommand)) {
    throw new Error(`Command '${baseCommand}' is blocked for security reasons`);
  }

  if (!SECURITY_CONFIG.allowedCommands.includes(baseCommand)) {
    throw new Error(
      `Command '${baseCommand}' is not in the allowed commands list`
    );
  }

  return true;
}

export class ProjectErrorHandler implements ErrorHandler {
  private retryDelays = [1000, 2000, 5000]; // Increasing delays between retries

  async onCommandFail(command: string, error: Error): Promise<void> {
    console.error(`Command failed: ${command}`);
    console.error(`Error: ${error.message}`);

    if (projectState) {
      projectState.commands.failed.push(command);
    }

    // Log the error for debugging
    console.error(`Full error details:`, error);
  }

  async onContainerFail(containerName: string, error: Error): Promise<void> {
    console.error(`Container failed: ${containerName}`);
    console.error(`Error: ${error.message}`);

    try {
      // Attempt to cleanup the failed container
      await dockerManager.cleanup_container(containerName);
    } catch (cleanupError) {
      console.error("Failed to cleanup container:", cleanupError);
    }
  }

  async retry(command: string, maxAttempts: number): Promise<void> {
    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        const terminal = dockerManager.spawn_docker_terminal(
          projectState.container_name
        );
        await execute_command_dynamically(
          command,
          projectState.current_dir,
          terminal
        );
        return; // Success
      } catch (error) {
        attempts++;
        console.error(`Attempt ${attempts} failed for command: ${command}`);

        if (attempts < maxAttempts) {
          // Wait before retrying with exponential backoff
          const delay =
            this.retryDelays[
              Math.min(attempts - 1, this.retryDelays.length - 1)
            ];
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          await this.onCommandFail(command, error as Error);
          throw error;
        }
      }
    }
  }
}
