const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const ASSISTANT_TYPES = new Set(["ai", "assistant"]);

function messageRole(message: Record<string, unknown>): string | undefined {
  const direct = message.type ?? message.role;
  if (typeof direct === "string") return direct;
  const kwargs = message.kwargs;
  if (isRecord(kwargs)) {
    const nested = kwargs.type ?? kwargs.role;
    if (typeof nested === "string") return nested;
  }
  return undefined;
}

function messageContent(message: Record<string, unknown>): unknown {
  if ("content" in message) return message.content;
  const kwargs = message.kwargs;
  if (isRecord(kwargs) && "content" in kwargs) return kwargs.content;
  return undefined;
}

function contentToText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = content
      .map((block) => {
        if (typeof block === "string") return block;
        if (isRecord(block) && typeof block.text === "string") return block.text;
        return "";
      })
      .filter((part) => part.length > 0);
    return parts.length > 0 ? parts.join("") : null;
  }
  return null;
}

/**
 * Best-effort extraction of the last assistant message's text from a
 * LangGraph `/threads/:id/state` `values` payload. Raptix's graphs may
 * serialize `messages` as plain dicts or as LangChain's full `dumpd` form
 * (`{kwargs: {...}}`); this handles both. Returns null rather than guessing
 * when nothing recognizable is found -- callers must treat that as "no
 * answer yet", never as an empty answer.
 */
export function extractLastAssistantText(values: Record<string, unknown>): string | null {
  const messages = values.messages;
  if (!Array.isArray(messages)) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isRecord(message)) continue;
    const role = messageRole(message);
    if (!role || !ASSISTANT_TYPES.has(role)) continue;
    const text = contentToText(messageContent(message));
    if (text !== null && text.length > 0) return text;
  }
  return null;
}
