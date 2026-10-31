// Exporting a conversation as Markdown: the document, the role labels, the dates, and the file name it is saved under.
// Pure; the caller fetches the conversation and triggers the download.

import { isInterruptContinueInjectChatMessage } from '../messages/text';

export interface ExportMessage {
  role?: string;
  content?: unknown;
  createdAt?: unknown;
  processDetails?: { eventType?: string; message?: unknown; timestamp?: unknown; data?: unknown }[];
  mcpExecutionIds?: unknown[];
}

export interface ExportConversation {
  id?: string;
  title?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  messages?: ExportMessage[];
}

export interface ExportOptions {
  includeToolDetails?: boolean;
}

/** A date in the export's fixed form, or empty when it is not a date. */
export function formatExportDate(value: unknown, locale: string): string {
  if (!value) return '';
  const date = new Date(value as string);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function roleLabel(role: unknown): string {
  switch (role) {
    case 'assistant': return 'Assistant';
    case 'user': return 'User';
    case 'system': return 'System';
    default: return role ? String(role) : 'Unknown';
  }
}

export function conversationToMarkdown(conversation: ExportConversation, options: ExportOptions, locale: string): string {
  const includeToolDetails = !!options.includeToolDetails;
  const title = (conversation.title ? String(conversation.title) : '').trim() || 'Untitled Conversation';
  const createdAt = formatExportDate(conversation.createdAt, locale);
  const updatedAt = formatExportDate(conversation.updatedAt, locale);
  const messages = Array.isArray(conversation.messages) ? conversation.messages : [];

  let markdown = `# ${title}\n\n`;
  markdown += `- Conversation ID: \`${conversation.id ? conversation.id : ''}\`\n`;
  if (createdAt) markdown += `- Created At: ${createdAt}\n`;
  if (updatedAt) markdown += `- Updated At: ${updatedAt}\n`;
  markdown += `- Message Count: ${messages.length}\n\n`;
  markdown += '---\n\n';

  if (messages.length === 0) {
    markdown += '_No messages in this conversation._\n';
    return markdown;
  }

  messages.forEach((message, index) => {
    if (message && message.role === 'user' && isInterruptContinueInjectChatMessage(message.content)) return;
    const role = roleLabel(message?.role);
    const timestamp = formatExportDate(message?.createdAt, locale);
    const content = message && typeof message.content === 'string' ? message.content : '';

    markdown += `## ${index + 1}. ${role}`;
    if (timestamp) markdown += ` (${timestamp})`;
    markdown += '\n\n';
    markdown += content ? `${content}\n\n` : '_[Empty message]_\n\n';

    if (Array.isArray(message?.processDetails) && message.processDetails.length > 0) {
      markdown += '### Process Details\n\n';
      message.processDetails.forEach(detail => {
        const detailTime = formatExportDate(detail?.timestamp, locale);
        const eventType = detail?.eventType ? detail.eventType : 'event';
        const detailMessage = detail?.message ? String(detail.message) : '';
        // Avoid "[label]:" lines: some Markdown parsers read them as link reference definitions.
        markdown += `- \`${eventType}\``;
        if (detailTime) markdown += ` ${detailTime}`;
        if (detailMessage) markdown += `: ${detailMessage}`;
        markdown += '\n';
        if (includeToolDetails && detail?.data && (eventType === 'tool_call' || eventType === 'tool_result')) {
          markdown += '\n```json\n';
          markdown += JSON.stringify(detail.data, null, 2) || '{}';
          markdown += '\n```\n';
        }
      });
      markdown += '\n';
    }

    if (Array.isArray(message?.mcpExecutionIds) && message.mcpExecutionIds.length > 0) {
      markdown += `- MCP Execution IDs: ${message.mcpExecutionIds.join(', ')}\n\n`;
    }
    markdown += '---\n\n';
  });

  return markdown;
}

/** A file name without characters a file system rejects, from the title and the start of the id. */
export function markdownFileName(conversation: ExportConversation, options: ExportOptions): string {
  const title = (conversation.title ? String(conversation.title) : '').trim() || 'conversation';
  const safeTitle = title
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 60) || 'conversation';
  const idPart = (conversation.id ? String(conversation.id) : '').slice(0, 8) || 'export';
  const modePart = options.includeToolDetails ? 'full' : 'summary';
  return `${safeTitle}_${idPart}_${modePart}.md`;
}
