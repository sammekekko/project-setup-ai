import dotenv from "dotenv";
import { existsSync, mkdirSync } from "fs";
import path from "path";
import { dockerManager, DockerError } from "./docker/docker";
import { ProjectErrorHandler } from "./lib/project/error_handler";
import { DEFAULT_CONFIG } from "./config";
import { MultiAgentSystem } from "./lib/ai/ai";

dotenv.config();

// Define a project state for tracking operations.
interface ProjectState {
  project_dir: string;
  container_name: string;
  state: string;
}

export let projectState: ProjectState = {
  project_dir: "",
  container_name: "",
  state: "init",
};

const errorHandler = new ProjectErrorHandler();

async function main(project_description: string) {
  try {
    const project_dir = path.resolve(process.cwd(), "generated-project");
    if (!existsSync(project_dir)) {
      console.log(`Creating project directory at: ${project_dir}`);
      mkdirSync(project_dir, { recursive: true });
    } else {
      console.log(`Project directory already exists at: ${project_dir}`);
    }
    // projectState.project_dir = project_dir;
    // projectState.current_dir = project_dir;

    try {
      projectState.container_name =
        await dockerManager.create_and_start_docker_container(
          project_dir,
          DEFAULT_CONFIG.resourceLimits
        );
      if (
        !(await dockerManager.is_container_healthy(projectState.container_name))
      ) {
        throw new DockerError("Container health check failed");
      }
    } catch (err) {
      await errorHandler.onContainerFail(
        projectState.container_name,
        err as Error
      );
      throw err;
    }

    try {
      console.log("Running AI agent for project creation...");
      // Usage
      const system = new MultiAgentSystem(projectState.container_name);
      const finalState = await system.run(project_description);
      // const finalState = await runProjectCreation(project_description);
      console.log("AI agent completed. Final state:", finalState);
      // (Optional: Process additional commands using your Docker terminal.)
      console.log("Project setup complete!");
      // console.log(
      //   "Completed commands:",
      //   projectState.commands.completed.length
      // );
      // console.log("Failed commands:", projectState.commands.failed.length);
    } catch (error) {
      console.error("Error during command execution:", error);
      throw error;
    } finally {
      if (projectState.container_name) {
        await dockerManager.cleanup_container(projectState.container_name);
      }
    }
  } catch (error) {
    console.error("Error during project setup:", error);
    throw error;
  } finally {
    if (projectState.container_name) {
      await dockerManager.cleanup_container(projectState.container_name);
    }
  }
}

const project_description = process.argv.slice(2).join(" ");
if (!project_description) {
  console.error(
    "Please provide a project description as a command line argument."
  );
  process.exit(1);
}

main(project_description).catch((err) => {
  console.error("Error during project setup:", err);
  process.exit(1);
});
