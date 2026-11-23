/** Shared helpers for processing stream events. */

/** Read text from a string or an array of content blocks. */
export function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) =>
        typeof block === "string"
          ? block
          : (block as { text?: string }).text ?? ""
      )
      .join("")
      .trim();
  }
  return "";
}

/** Remove internal result tags before display. */
export function stripResultTags(text: string): string {
  return text.replace(/<\/?result>/g, "").trim();
}
