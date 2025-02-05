import path from "path";
import fs from "fs";

export function strip_ansi(str: string): string {
  return str.replace(/\x1B\[[0-?]*[ -\/]*[@-~]/g, "");
}

export function get_dependency_names(
  project_directory
):
  | { dependencies: string[]; dev_dependencies: string[] }
  | { error: string | Error } {
  let package_json_path = path.join(project_directory, "package.json");
  let package_data: any;

  // If package.json is not in the root, search immediate subdirectories.
  if (!fs.existsSync(package_json_path)) {
    const entries = fs.readdirSync(project_directory, { withFileTypes: true });
    let found = false;
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const candidate = path.join(
          project_directory,
          entry.name,
          "package.json"
        );
        if (fs.existsSync(candidate)) {
          package_json_path = candidate;
          found = true;
          break;
        }
      }
    }
    if (!found) {
      const error_text = "Package.json has not been built yet.";
      console.error(error_text);
      return { error: error_text };
    }
  }

  try {
    // Read and parse package.json
    package_data = JSON.parse(fs.readFileSync(package_json_path, "utf-8"));
  } catch (error) {
    const error_text = "Package.json could not be read.";
    return { error: error_text };
  }

  // Get the dependency names or use empty arrays if they don't exist
  const dependencies = package_data.dependencies
    ? Object.keys(package_data.dependencies)
    : [];
  const dev_dependencies = package_data.devDependencies
    ? Object.keys(package_data.devDependencies)
    : [];

  return { dependencies, dev_dependencies };
}

export function prepare_dependency_names(dependencies) {
  let output: string;
  if (!dependencies) {
    throw new Error("Failed to get dependency names");
  }

  if ("error" in dependencies) {
    output = dependencies.error;
  }

  output = JSON.stringify(dependencies);
  return output;
}

export const setup_log_regex = new RegExp(
  [
    "^(?:",
    ".*[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏].*", // Spinner chars
    "|.*fetch\\s+GET.*", // fetch GET
    "|added\\s+\\d+\\s+packages?\\s+in\\s+\\d+s", // "added 99 packages in 2s"
    "|\\d+\\s+packages?\\s+are\\s+looking\\s+for\\s+funding", // funding
    "|npm\\s+fund", // "npm fund"
    "|npm\\s+(?:ERR|WARN|notice|info|verb|timing|sill|http)!?.*", // npm logs
    ")$",
  ].join("")
);

// Keymap used for interactions sent by the AI
export const key_map: Record<string, string> = {
  up: "\x1B[A",
  down: "\x1B[B",
  left: "\x1B[D",
  right: "\x1B[C",
  enter: "\r",
};

/**
 * Determines whether the prompt text indicates an interactive menu
 * that likely requires keystroke (arrow key) navigation.
 */
export function is_interactive_menu(text: string): boolean {
  const lower = text.toLowerCase();
  // Check for common interactive menu cues (adjust as needed)
  const interactive_cues = [
    "arrow",
    "use arrow",
    "navigate with",
    "select an option",
    "choose an option",
    "move to",
    "press enter",
    "press return",
    "use the arrow keys",
    "use arrow keys",
    "arrow-keys",
    "return to submit",
  ];

  return interactive_cues.some((cue) => lower.includes(cue));
}

// Helper function to detect if the given text is an interactive prompt.
export function is_prompt(text: string): boolean {
  const trimmed = text.trim();
  const lowerText = trimmed.toLowerCase();
  // Check if the text starts or ends with a question mark
  if (trimmed.startsWith("?") || trimmed.endsWith("?")) {
    return true;
  }

  // Check for common yes/no patterns
  if (lowerText.includes("y/n") || lowerText.includes("n/y")) {
    return true;
  }

  // Check for multiple choice patterns, e.g. "1)", "2)", etc.
  if (/\d+\)/.test(trimmed)) {
    return true;
  }

  // Fallback: if the text contains a question mark anywhere and the prompt is relatively short,
  // it might be an interactive prompt.
  if (trimmed.includes("?") && trimmed.length < 100) {
    return true;
  }
  return false;
}
