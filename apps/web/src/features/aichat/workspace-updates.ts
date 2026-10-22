/** Whether an assistant message is a short progress line that may fold into a group with its neighbours. */
export function isFoldableUpdate(message: { role: string; content: string; reasoning?: string }): boolean {
  const text = message.content.trim()
  return message.role === 'assistant' && text.length > 0 && text.length <= 160 && !text.includes('\n') && !text.includes('```') && !message.reasoning
}
