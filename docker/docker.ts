import * as fs from "fs";
import path from "path";
import { spawn, IPty } from "@lydell/node-pty";
import { exec } from "child_process";
import { DEFAULT_CONFIG, ContainerConfig } from "../config";

// Types and interfaces

interface ContainerInfo {
  id: string;
  name: string;
  status: string;
  created: Date;
  projectDir: string;
}

class DockerError extends Error {
  constructor(
    message: string,
    public readonly command?: string,
    public readonly stderr?: string
  ) {
    super(message);
    this.name = "DockerError";
  }
}

/**
 * Executes a shell command with timeout and proper error handling
 */
export async function exec_promise(
  command: string,
  cwd: string,
  timeout: number = DEFAULT_CONFIG.resourceLimits.timeout
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child_process = exec(
      command,
      { cwd, env: process.env },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new DockerError(`Error executing "${command}"`, command, stderr)
          );
          return;
        }
        resolve(stdout);
      }
    );

    // Set timeout
    const timeoutId = setTimeout(() => {
      child_process.kill();
      reject(
        new DockerError(`Command timed out after ${timeout}ms: ${command}`)
      );
    }, timeout);

    // Clear timeout on completion
    child_process.on("exit", () => clearTimeout(timeoutId));
  });
}

/**
 * Docker Container Manager class
 * Handles container lifecycle, health checks, and cleanup
 */
export class DockerContainerManager {
  private containers: Map<string, ContainerInfo> = new Map();
  private config: ContainerConfig;

  constructor(config: Partial<ContainerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Creates and starts a Docker container with proper resource limits and monitoring
   */
  async create_and_start_docker_container(
    projectDir: string,
    resource_limits?: ContainerConfig["resourceLimits"]
  ): Promise<string> {
    const containerName = `project-${Date.now()}`;

    if (resource_limits) {
      this.config.resourceLimits = {
        ...this.config.resourceLimits,
        memory: resource_limits.memory,
        cpu: resource_limits.cpu,
        timeout: resource_limits.timeout,
      };
    }

    try {
      // Read and validate Dockerfile template
      const templatePath = path.resolve(
        process.cwd(),
        "./docker/Dockerfile-template"
      );
      const dockerfileTemplate = await this.read_dockerfile_template(
        templatePath
      );

      // Create Dockerfile in project directory
      await this.create_dockerfile(projectDir, dockerfileTemplate);

      // Build and start container
      const imageName = await this.build_docker_image(projectDir);
      await this.start_docker_container(containerName, imageName, projectDir);

      // Register container
      this.containers.set(containerName, {
        id: containerName,
        name: containerName,
        status: "running",
        created: new Date(),
        projectDir,
      });

      // Verify container health
      await this.verify_container_health(containerName);

      return containerName;
    } catch (error) {
      // Cleanup on failure
      await this.cleanup_container(containerName).catch(() => {});
      throw error;
    }
  }

  /**
   * Reads and validates the Dockerfile template
   */
  private async read_dockerfile_template(
    templatePath: string
  ): Promise<string> {
    try {
      const template = await fs.promises.readFile(templatePath, "utf8");
      console.log(`Using Dockerfile template from ${templatePath}`);
      return template;
    } catch (error) {
      throw new DockerError(
        `Error reading Dockerfile template: ${error.message}`,
        undefined,
        error.stack
      );
    }
  }

  /**
   * Creates Dockerfile in the project directory
   */
  private async create_dockerfile(
    projectDir: string,
    template: string
  ): Promise<void> {
    const dockerfilePath = path.join(projectDir, "Dockerfile");
    try {
      await fs.promises.writeFile(dockerfilePath, template, "utf8");
      console.log(`Dockerfile created at ${dockerfilePath}`);
    } catch (error) {
      throw new DockerError(
        `Error writing Dockerfile: ${error.message}`,
        undefined,
        error.stack
      );
    }
  }

  /**
   * Builds Docker image from Dockerfile
   */
  private async build_docker_image(projectDir: string): Promise<string> {
    const imageName = "generated-project-image";
    try {
      console.log("Building Docker image...");
      await exec_promise(`docker build -t ${imageName} .`, projectDir);
      console.log("Docker image built successfully.");
      return imageName;
    } catch (error) {
      throw new DockerError(
        `Error building Docker image: ${error.message}`,
        error.command,
        error.stderr
      );
    }
  }

  /**
   * Starts Docker container with resource limits
   */
  private async start_docker_container(
    containerName: string,
    imageName: string,
    projectDir: string
  ): Promise<void> {
    try {
      console.log("Starting Docker container...");
      const docker_run_cmd = [
        "docker run -d --rm",
        `--name ${containerName}`,
        `--memory=${this.config.resourceLimits.memory}`,
        `--cpus=${this.config.resourceLimits.cpu}`,
        `--memory-swap=${this.config.resourceLimits.memory}`, // Disable swap
        "--ulimit nofile=65535:65535", // Set file descriptor limits
        `-v "${projectDir}":${this.config.workdir}`,
        imageName,
      ].join(" ");

      await exec_promise(docker_run_cmd, projectDir);
      console.log("Docker container started successfully.");
    } catch (error) {
      throw new DockerError(
        `Error starting Docker container: ${error.message}`,
        error.command,
        error.stderr
      );
    }
  }

  /**
   * Verifies container health
   */
  private async verify_container_health(containerName: string): Promise<void> {
    try {
      const status = await exec_promise(
        `docker inspect --format='{{.State.Status}}' ${containerName}`,
        process.cwd()
      );

      if (status.trim() !== "running") {
        throw new DockerError(
          `Container ${containerName} is not running: ${status}`
        );
      }
    } catch (error) {
      throw new DockerError(
        `Container health check failed: ${error.message}`,
        error.command,
        error.stderr
      );
    }
  }

  /**
   * Spawns a new interactive shell in the container
   */
  spawn_docker_terminal(containerName: string): IPty {
    // Verify container exists
    if (!this.containers.has(containerName)) {
      throw new DockerError(`Container ${containerName} not found`);
    }

    return spawn(
      "docker",
      [
        "exec",
        "-it",
        "-e",
        "TERM=xterm",
        "-e",
        "FORCE_COLOR=true",
        "-w",
        this.config.workdir,
        containerName,
        "/bin/sh",
      ],
      {
        name: "docker-terminal",
        cols: 100,
        rows: 50,
        env: process.env,
        handleFlowControl: true,
      }
    );
  }

  /**
   * Checks if a container is healthy
   */
  async is_container_healthy(containerName: string): Promise<boolean> {
    try {
      await this.verify_container_health(containerName);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Cleans up a container and associated resources
   */
  async cleanup_container(containerName: string): Promise<void> {
    try {
      // Stop container
      await exec_promise(`docker stop ${containerName}`, process.cwd()).catch(
        () => {}
      );

      // Remove container
      await exec_promise(`docker rm -f ${containerName}`, process.cwd()).catch(
        () => {}
      );

      // Remove from tracking
      this.containers.delete(containerName);

      console.log(`Container ${containerName} cleaned up successfully`);
    } catch (error) {
      console.error(`Error cleaning up container ${containerName}:`, error);
      // Don't throw - cleanup should be best-effort
    }
  }

  /**
   * Cleans up all managed containers
   */
  async cleanup_all(): Promise<void> {
    const cleanupPromises = Array.from(this.containers.keys()).map(
      (containerName) => this.cleanup_container(containerName)
    );
    await Promise.all(cleanupPromises);
  }

  /**
   * Gets information about a container
   */
  get_container_info(containerName: string): ContainerInfo | undefined {
    return this.containers.get(containerName);
  }
}

// Export singleton instance
export const dockerManager = new DockerContainerManager();

// Export types
export type { ContainerConfig, ContainerInfo };
export { DockerError };
