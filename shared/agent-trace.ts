export type AgentTraceStepKind =
  "context" | "response" | "search" | "source" | "tool" | "approval";

/**
 * A concise, user-visible record of actions Rook actually completed. This is
 * deliberately not a model reasoning trace: it contains no hidden prompts,
 * private chain-of-thought, credentials, or raw tool payloads.
 */
export type AgentTraceStep = {
  kind: AgentTraceStepKind;
  title: string;
  detail?: string;
  url?: string;
};
