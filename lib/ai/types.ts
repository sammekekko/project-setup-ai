import { BaseMessage } from "@langchain/core/messages";

export type TaskPriority = "high" | "medium" | "low";

export interface ProjectContext {
  description: string;
  techStack?: {
    tool_name: string;
    tool_command: string;
  }[];
  workdir?: string;
}

export interface BaseAgent {
  containerName: string;
  run(state: AgentState): Promise<AgentState>;
}

export interface BaseTask {
  type: string;
  description: string;
  priority: TaskPriority;
  error?: string;
}

// Task Results
export interface CodeGenerationResult {
  content: string;
  success: boolean;
  validationResult?: boolean;
}

export interface FileCreationResult {
  filename: string;
  content?: string;
  success: boolean;
}

export interface TerminalResult {
  output: string;
  success: boolean;
}

// Tasks with Results
export interface CodeGenerationTask extends BaseTask {
  type: "code";
  filename: string;
  language: string;
  goal: string;
  content?: string;
  result?: CodeGenerationResult;
}

export interface FileCreationTask extends BaseTask {
  type: "file";
  filename: string;
  directory: string;
  content?: string;
  result?: FileCreationResult;
}

export interface TerminalTask extends BaseTask {
  type: "terminal";
  directory: string;
  commands: string[];
  expectedPrompts?: Record<string, string>;
  result?: TerminalResult;
}

export interface TasksState {
  codeGeneration: CodeGenerationTask[];
  fileCreation: FileCreationTask[];
  terminal: TerminalTask[];
}

export interface AgentState {
  messages: BaseMessage[];
  project_context: ProjectContext;
  current_stage: string;
  next?: string;
}

export interface TerminalChanges {
  succeededCommands: string[];
  failedCommands: string[];
  createdFiles: string[];
  changedFiles: Array<{
    fileDir: string;
    changesSummarized: string;
  }>;
}
