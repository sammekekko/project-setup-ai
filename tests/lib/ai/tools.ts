import { setDefaultContainer, tools } from "../../../lib/ai/tools";
import * as path from "path";
import * as fs from "fs/promises";
import { existsSync } from "fs";
import { dockerManager } from "../../../docker/docker";
import dotenv from "dotenv";

dotenv.config();

// Base path for all tests
const BASE_PATH = path.join(process.cwd(), "generated-project");

async function setupTestEnvironment() {
  console.log("Setting up test environment...");

  // Ensure base directory exists
  if (!existsSync(BASE_PATH)) {
    console.log("Creating base directory:", BASE_PATH);
    await fs.mkdir(BASE_PATH, { recursive: true });
  }

  // Setup Docker container
  console.log("Setting up Docker container...");
  try {
    // Check if container exists
    const container_name =
      await dockerManager.create_and_start_docker_container(BASE_PATH);

    // Set as default container for tools
    setDefaultContainer(container_name);
    console.log("Docker container ready");
  } catch (error) {
    console.error("Failed to setup Docker container:", error);
    throw error;
  }
}

async function main() {
  try {
    console.log("Starting tool tests...\n");

    await setupTestEnvironment();
    console.log("✓ Base directory check complete\n");

    // Test write_file_tool
    console.log("Testing write_file_tool...");
    await tools.write_file.func({
      filename: "test.txt",
      write_path: BASE_PATH + "/test", // Using full path
      content: "This is a test file",
    });
    console.log("✓ write_file_tool test complete\n");

    // Test read_file_tool
    console.log("Testing read_file_tool...");
    const readResult = await tools.read_file.func({
      filename: "test.txt",
      relative_path: "test",
      working_directory: BASE_PATH, // Using full path
    });
    console.log("Read content:", readResult);
    console.log("✓ read_file_tool test complete\n");

    // Test list_files_tool
    console.log("Testing list_files_tool...");
    const listResult = await tools.list_files.func({
      relative_path: "test", // Using full path
    });
    console.log("Listed files:", listResult);
    console.log("✓ list_files_tool test complete\n");

    // Test get_project_files
    console.log("Testing get_project_files...");
    const projectFiles = await tools.get_project_files.func({
      directory: path.join(BASE_PATH, "test"),
      fileTypes: ["txt"],
    });
    console.log("Project files:", projectFiles);
    console.log("✓ get_project_files test complete\n");

    // Test write_code tool
    console.log("Testing write_code tool...");
    await tools.write_code.func({
      filename: "test.js",
      entire_path: path.join(BASE_PATH, "test"),
      code: "console.log('Hello World');",
    });
    console.log("✓ write_code tool test complete\n");

    // Test validate_code tool
    console.log("Testing validate_code tool...");
    const validationResult = await tools.validate_code.func({
      code: "console.log('Hello World');",
      language: "javascript",
    });
    console.log("Validation result:", validationResult);
    console.log("✓ validate_code tool test complete\n");

    // Test command_tool
    console.log("Testing command_tool...");
    const commandResult = await tools.execute_command.func({
      commands: [
        { command: "mkdir -p test-dir" },
        { command: "cd test-dir && echo 'test' > test.txt" },
        { command: "npx create-next-app@latest" },
      ],
      working_directory: "/generated-project",
    });
    console.log("Command result:", commandResult);
    console.log("✓ command_tool test complete\n");

    // Test library context
    console.log("Testing get_library_context...");
    const libraryContext = await tools.get_library_context.func({
      query: "React application setup",
    });
    console.log("Library context:", libraryContext);
    console.log("✓ get_library_context test complete\n");

    // Test analyze_project
    console.log("Testing analyze_project...");
    const analysisResult = await tools.analyze_project.func({
      context: { project: "test project" },
      files: JSON.stringify({
        "test/test.js": "console.log('Hello World');",
        "test/test.txt": "This is a test file",
      }),
    });
    console.log("Analysis result:", analysisResult);
    console.log("✓ analyze_project test complete\n");

    console.log("All tests completed successfully!");
  } catch (error) {
    console.error("Test failed:", error);
  }
}

main();
