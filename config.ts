export interface SecurityConfig {
  allowedCommands: string[];
  blockedCommands: string[];
}

export interface ContainerConfig {
  resourceLimits: {
    memory: string;
    cpu: string;
    timeout: number;
  };
  workdir: string;
}

// Default configuration
export const DEFAULT_CONFIG: ContainerConfig = {
  resourceLimits: {
    memory: "2g",
    cpu: "2",
    timeout: 300000, // 5 minutes
  },
  workdir: "/app",
};

// Security configuration, commands that are allowed and blocked for the Ai to run.
export const SECURITY_CONFIG: SecurityConfig = {
  allowedCommands: [
    "npm",
    "pnpm",
    "yarn",
    "npx",
    "node",
    "cd",
    "mkdir",
    "touch",
    "rm",
    "cp",
    "mv",
  ],
  blockedCommands: ["sudo", "chmod", "chown", "curl", "wget", "ssh", "scp"],
};
