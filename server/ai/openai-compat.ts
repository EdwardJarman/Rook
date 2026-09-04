import type {
  InvokeParams,
  Message,
  MessageContent,
  ResponseFormat,
  Tool,
  ToolChoice,
} from "../_core/llm";

export const normalizeContent = (content: MessageContent | MessageContent[]) => {
  const parts = Array.isArray(content) ? content : [content];
  if (parts.length === 1 && typeof parts[0] === "string") return parts[0];
  return parts.map((part) =>
    typeof part === "string" ? { type: "text", text: part } : part,
  );
};

export const normalizeMessages = (messages: Message[]) =>
  messages.map((message) => ({
    role: message.role,
    content:
      message.role === "tool" || message.role === "function"
        ? (Array.isArray(message.content)
            ? message.content
                .map((part) =>
                  typeof part === "string" ? part : JSON.stringify(part),
                )
                .join("\n")
            : typeof message.content === "string"
              ? message.content
              : JSON.stringify(message.content))
        : normalizeContent(message.content),
    ...(message.name ? { name: message.name } : {}),
    ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
    ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}),
  }));

export const normalizeToolChoice = (
  choice: ToolChoice | undefined,
  tools: Tool[] | undefined,
) => {
  if (!choice || choice === "none" || choice === "auto") return choice;
  if (choice === "required") {
    if (!tools?.length) throw new Error("A required tool was not provided.");
    if (tools.length > 1) return "required";
    return { type: "function", function: { name: tools[0].function.name } };
  }
  if ("name" in choice)
    return { type: "function", function: { name: choice.name } };
  return choice;
};

export const responseFormatFor = (params: InvokeParams): ResponseFormat | undefined => {
  const explicit = params.responseFormat ?? params.response_format;
  if (explicit) return explicit;
  const schema = params.outputSchema ?? params.output_schema;
  return schema
    ? { type: "json_schema", json_schema: schema }
    : undefined;
};

export async function readJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    return {} as T;
  }
}