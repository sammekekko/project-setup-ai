import * as fs from "fs";
import os from "os";
import path from "path";
// import { exec, spawn } from "child_process";
import { spawn, IPty } from "@lydell/node-pty";
import { exec } from "child_process";

/**
 * Executes a shell command in a given working directory.
 */
export async function exec_promise(
  command: string,
  cwd: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(command, { cwd, env: process.env }, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error executing "${command}":\n`, stderr);
        return reject(error);
      }
      resolve(stdout);
    });
  });
}

/**
 * Creates a Dockerfile (from a template) in the project directory,
 * builds a Docker image, and runs a Docker container.
 *
 * The container is started in detached mode and mounts the project directory
 * to /app inside the container.
 *
 * Returns the container name.
 */
export async function create_and_start_docker_container(
  projectDir: string
): Promise<string> {
  // Define your Dockerfile template. Adjust as needed.
  const templatePath = path.resolve(
    process.cwd(),
    "./docker/Dockerfile-template"
  );
  let dockerfileTemplate: string;
  try {
    dockerfileTemplate = await fs.promises.readFile(templatePath, "utf8");
    console.log(`Using Dockerfile template from ${templatePath}`);
  } catch (error) {
    console.error("Error reading Dockerfile template:", error);
    throw error;
  }

  // Write the Dockerfile to the project directory.
  const dockerfilePath = path.join(projectDir, "Dockerfile");
  try {
    await fs.promises.writeFile(dockerfilePath, dockerfileTemplate, "utf8");
    console.log(`Dockerfile created at ${dockerfilePath}`);
  } catch (error) {
    console.error("Error writing Dockerfile:", error);
    throw error;
  }

  // Build the Docker image from the Dockerfile.
  const imageName = "generated-project-image";
  try {
    console.log("Building Docker image...");
    await exec_promise(`docker build -t ${imageName} .`, projectDir);
    console.log("Docker image built successfully.");
  } catch (error) {
    console.error("Error building Docker image:", error);
    throw error;
  }

  // Run the Docker container in detached mode.
  // Mount the projectDir to /app so that the container sees only the generated project.
  const containerName = "generated-project-container";
  try {
    console.log("Starting Docker container...");
    await exec_promise(
      `docker run -d --rm --name ${containerName} -v "${projectDir}":/app ${imageName}`,
      projectDir
    );
    console.log("Docker container started successfully.");
  } catch (error) {
    console.error("Error starting Docker container:", error);
    throw error;
  }

  return containerName;
}

/**
 * Spawns a new interactive shell in the running Docker container
 * using "docker exec" and Node's child_process.spawn.
 *
 * This function returns the spawned child process so that you can
 * attach listeners or otherwise control it if needed.
 */
export function spawn_docker_terminal(containerName: string): IPty {
  return spawn("docker", ["exec", "-i", containerName, "/bin/sh"], {
    cwd: process.cwd(),
    name: "docker-terminal",
    cols: 100,
    rows: 50,
    env: process.env,
  });
}
