/**
 * Conversation listing for the session's project. The control plane owns the conversations, their titles and their
 * recency, so the CLI only reads them. The list is scoped to one project and never shows another project's threads.
 */

import type { FacadeClient } from "../transport/facadeClient.js";

export interface ThreadEntry {
  /** Conversation id on the control plane. */
  threadId: string;
  /** Assistant the conversation was created with. */
  assistantId: string;
  /** ISO timestamp of the conversation's last update. */
  lastUsed: string;
  title: string;
}

const MAX_ENTRIES = 20;

/** Conversations of one project, most recent first. A failed read is an empty list, as before. */
export async function listThreads(facade: FacadeClient, engagementId: string): Promise<ThreadEntry[]> {
  try {
    const { threads } = await facade.listThreads(engagementId);
    return threads.slice(0, MAX_ENTRIES).map(thread => ({
      threadId: thread.threadId,
      assistantId: thread.assistantId,
      lastUsed: thread.updatedAt,
      title: thread.title || `Session ${thread.threadId.slice(0, 8)}`,
    }));
  } catch {
    return [];
  }
}

/** One conversation by its position in the list, or null. */
export async function loadThreadByIndex(facade: FacadeClient, engagementId: string, index: number): Promise<ThreadEntry | null> {
  const entries = await listThreads(facade, engagementId);
  return entries[index] ?? null;
}
