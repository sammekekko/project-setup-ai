import path from "path";
import fs from "fs";

export function strip_ansi(str: string): string {
  return str.replace(/\x1B\[[0-?]*[ -\/]*[@-~]/g, "");
}

export async function get_dependency_names(project_directory) {
  let package_json_path = path.join(project_directory, "package.json");
  let final_package_json_path = package_json_path;

  // Check if package.json exists in the root directory.
  try {
    await fs.promises.access(package_json_path, fs.constants.F_OK);
  } catch (err) {
    // If not found, search in immediate subdirectories.
    let found = false;
    try {
      const entries = await fs.promises.readdir(project_directory, {
        withFileTypes: true,
      });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const candidate = path.join(
            project_directory,
            entry.name,
            "package.json"
          );
          try {
            await fs.promises.access(candidate, fs.constants.F_OK);
            final_package_json_path = candidate;
            found = true;
            break;
          } catch (candidateErr) {
            // Candidate package.json does not exist; continue checking.
          }
        }
      }
    } catch (readDirErr) {
      // If the directory couldn't be read, return an error.
      const error_text = "Could not read the project directory.";
      console.error(error_text);
      return { error: error_text };
    }
    if (!found) {
      const error_text = "Package.json has not been built yet.";
      console.error(error_text);
      return { error: error_text };
    }
  }

  let package_data;
  try {
    // Read and parse package.json asynchronously.
    const fileContent = await fs.promises.readFile(
      final_package_json_path,
      "utf-8"
    );
    package_data = JSON.parse(fileContent);
  } catch (error) {
    const error_text = "Package.json could not be read.";
    console.error(error_text);
    return { error: error_text };
  }

  // Get dependency names or use empty arrays if they don't exist.
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
    ".*[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏].*", // Spinner characters
    "|.*fetch\\s+GET.*", // fetch GET messages
    "|added\\s+\\d+\\s+packages?\\s+in\\s+\\d+s", // "added 99 packages in 2s"
    "|\\d+\\s+packages?\\s+are\\s+looking\\s+for\\s+funding", // funding messages
    "|npm\\s+fund", // "npm fund"
    "|npm\\s+(?:WARN|notice|info|verb|timing|sill|http)!?.*", // npm logs
    // --- Existing progress and download filters ---
    "|Progress:.*", // Progress output lines
    "|Downloading.*", // Downloading messages
    "|node_modules\\/\\.pnpm\\/.*", // pnpm internal messages
    "|Packages:\\s+\\+\\d+", // Package count summaries
    // --- Additional suggestions ---
    "|.*Running postinstall script.*", // Postinstall messages
    "|.*done in \\d+ms.*", // Postinstall completion messages
    "|^[+-]{5,}$", // Lines of repeated '+' or '-' characters
    "|\\d+(\\.\\d+)?\\s*(?:B|kB|MB|GB)/\\d+(\\.\\d+)?\\s*(?:B|kB|MB|GB)", // Progress size info
    "|.*\\.pnpm\\/.*", // Other pnpm paths (redundant if needed)
    "|.*cache\\/.*", // Cache-related messages
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

export function has_menu_structure(text: string): boolean {
  // Check for common menu indicators
  const menuIndicators = [
    // Radio-style selections
    text.includes("●") || text.includes("○"),
    // Common CLI selection markers
    text.includes("❯") || text.includes("→"),
    // Square brackets style
    /\[\s*[X\s]\s*\]/.test(text),
    // Numbered options
    /^\s*\d+\)\s/.test(text),
    // Common select markers
    text.includes("(*)") || text.includes("( )"),
    // Arrow indicators
    text.includes("▶") || text.includes("▷"),
    text.includes("[?25l"), // Cursor hide sequence
  ];

  return menuIndicators.some((indicator) => indicator);
}

/**
 * Determines whether the prompt text indicates an interactive menu
 * that likely requires keystroke (arrow key) navigation.
 */
export function is_interactive_menu(text: string): boolean {
  const lower = text.toLowerCase();
  // Check for common interactive menu cues
  const interactive_cues = [
    "what would you like to do?",
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
    "●", // Unicode bullet for selected item
    "○", // Unicode circle for unselected item
  ];

  // Check for menu-like structure
  const hasMenuStructure = has_menu_structure(lower);

  return (
    interactive_cues.some((cue) => lower.includes(cue)) || hasMenuStructure
  );
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
