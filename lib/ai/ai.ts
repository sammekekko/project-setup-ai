import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { StateGraph, START, END } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { RunnableConfig } from "@langchain/core/runnables";
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import {
  HumanMessage,
  SystemMessage,
  BaseMessage,
} from "@langchain/core/messages";
import { Annotation } from "@langchain/langgraph";
import { z } from "zod";

// Import agents
import { AgentState } from "./types";
import { setDefaultContainer, tools } from "./tools";
import { projectState } from "../../runner";

// Define state
const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  working_directory: Annotation<string>({
    reducer: (prev: string, curr: string) => curr ?? prev,
    default: () => "/generated-project",
  }),
  next: Annotation<string>({
    reducer: (x, y) => y ?? x ?? END,
    default: () => END,
  }),
  project_context: Annotation<any>({
    reducer: (prev: any, curr: any) => ({ ...prev, ...curr }),
    default: () => ({}),
  }),
  current_stage: Annotation<string>({
    reducer: (prev: string, curr: string) => curr ?? prev,
    default: () => "init",
  }),
});

// Team members and types
const TEAM_MEMBERS = [
  "project_creator",
  "code_generator",
  "file_creator",
  "terminal_controller",
  "reviewer",
] as const;

// Enhanced system prompts
const SYSTEM_PROMPTS = {
  supervisor: `You are a supervisor tasked with managing a team consisting of:
- project_creator: Analyzes project requirements and determines tech stack
- code_generator: Creates and modifies code files
- file_creator: Creates and organizes project files
- terminal_controller: Executes necessary terminal commands (Always begin your setup here)
- reviewer: Reviews and validates project state
Your job is to coordinate their work and ensure the project requirements are met.
When the project is complete, respond with FINISH.

This is your workflow:

1. Begin by setting up the project with the terminal_controller, run neccesarry commands to make sure that the project gets a good starting point.
2. Use other agents such as file_creator, or code_generator, to modify code inside the project or add files such as README.md
3. Make sure to always review the project using the reviewer, this agent will make sure that the project is done correctly.
4. When done respond with FINISH`,
  project_creator: `You analyze project requirements and determine appropriate tech stack and tools.`,
  code_generator: `You generate clean, efficient, and well-documented code.`,
  file_creator: `You create and organize project files and directories effectively.`,
  terminal_controller: `You execute terminal commands safely and handle command sequences.`,
  reviewer: `You review project state and ensure all requirements are met.`,
};

// Routing tool for supervisor
const routingTool = {
  name: "route",
  description: "Select the next agent to act.",
  schema: z.object({
    next: z.enum([END, ...TEAM_MEMBERS]),
  }),
};

export class MultiAgentSystem {
  private llm: ChatOpenAI;
  private graph;
  private supervisorChain;
  private containerName;
  private agents = {
    project_creator: { tools: [tools.get_library_context] },
    code_generator: { tools: [tools.write_code, tools.validate_code] },
    file_creator: { tools: [tools.write_file] },
    terminal_controller: { tools: [tools.execute_command] },
    reviewer: {
      tools: [
        tools.analyze_project,
        tools.list_files,
        tools.read_file,
        tools.get_project_files,
      ],
    },
  };
  private initialized: boolean = false;

  constructor(containerName: string) {
    this.llm = new ChatOpenAI({
      modelName: "gpt-4o",
      temperature: 0.2,
    });

    this.containerName = containerName;
    setDefaultContainer(containerName);
    this.graph = new StateGraph(AgentState);
  }

  private async initializeSystem() {
    if (this.initialized) return;

    // Create supervisor prompt and chain
    const supervisorPrompt = ChatPromptTemplate.fromMessages([
      ["system", SYSTEM_PROMPTS.supervisor],
      new MessagesPlaceholder("messages"),
      [
        "human",
        "Given the current state, who should act next? Choose from: {options}",
      ],
    ]);

    const formattedPrompt = await supervisorPrompt.partial({
      options: [END, ...TEAM_MEMBERS].join(", "),
    });

    this.supervisorChain = formattedPrompt
      .pipe(this.llm.bindTools([routingTool], { tool_choice: "route" }))
      .pipe((x) => x.tool_calls?.[0]?.args ?? { next: END });

    await this.configureGraph();
    this.initialized = true;
  }

  private async configureGraph() {
    // Create agent nodes with enhanced functionality
    const createAgentNode = (agentKey: keyof typeof this.agents) => {
      const agent = createReactAgent({
        llm: this.llm,
        tools: this.agents[agentKey].tools,
        stateModifier: new SystemMessage(SYSTEM_PROMPTS[agentKey]),
      });

      return async (
        state: typeof AgentState.State,
        config?: RunnableConfig
      ) => {
        const reactResult = await agent.invoke(state, config);
        const lastMessage =
          reactResult.messages[reactResult.messages.length - 1];

        const toolResponse = reactResult.structuredResponse?.output;
        const newWorkingDirectory =
          toolResponse?.working_directory || state.working_directory;

        if (state.current_stage) {
          projectState.state = state.current_stage;
        }

        // Return merged state with new messages
        return {
          ...reactResult,
          working_directory: newWorkingDirectory,
          project_context: {
            ...state.project_context,
            last_agent: agentKey,
            timestamp: new Date().toISOString(),
          },
          messages: [
            new HumanMessage({
              content: lastMessage.content,
              name: agentKey,
            }),
          ],
        };
      };
    };

    // Add nodes to graph with appropriate tools
    this.graph
      .addNode("supervisor", this.supervisorChain)
      .addNode("project_creator", createAgentNode("project_creator"))
      .addNode("code_generator", createAgentNode("code_generator"))
      .addNode("file_creator", createAgentNode("file_creator"))
      .addNode("terminal_controller", createAgentNode("terminal_controller"))
      .addNode("reviewer", createAgentNode("reviewer"));

    // Add edges
    TEAM_MEMBERS.forEach((member) => {
      this.graph.addEdge(member, "supervisor");
    });

    this.graph.addConditionalEdges(
      "supervisor",
      (state: typeof AgentState.State) => state.next
    );
    this.graph.addEdge(START, "project_creator");
    this.graph.addEdge("project_creator", "supervisor");
  }

  public async run(projectDescription: string) {
    await this.initializeSystem();

    // Initialize project state
    projectState.project_dir = "/generated-project";
    projectState.container_name = this.containerName;
    projectState.state = "init";

    const initialState: typeof AgentState.State = {
      messages: [new HumanMessage(projectDescription)],
      next: END,
      project_context: { description: projectDescription },
      working_directory: "/generated-project",
      current_stage: "init",
    };

    const compiledGraph = this.graph.compile();

    // Stream results
    const streamResults = await compiledGraph.stream(initialState, {
      recursionLimit: 100,
    });

    for await (const output of streamResults) {
      if (!output?.__end__) {
        console.log(output);
        console.log("----");
      }
    }
  }
}
