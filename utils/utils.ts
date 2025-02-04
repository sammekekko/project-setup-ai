export function stripANSI(str: string): string {
  return str.replace(/\x1B\[[0-?]*[ -\/]*[@-~]/g, "");
}

export const setupLogRegex = new RegExp(
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
export const keyMap: Record<string, string> = {
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
export function isInteractiveMenu(text: string): boolean {
  const lower = text.toLowerCase();
  // Check for common interactive menu cues (adjust as needed)
  const interactiveCues = [
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

  return interactiveCues.some((cue) => lower.includes(cue));
}

// Helper function to detect if the given text is an interactive prompt.
export function isPrompt(text: string): boolean {
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
