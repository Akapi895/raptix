// The batch manager of the conversations: a dialog that lists every conversation with a checkbox each, narrows them by a
// search text and a project, and deletes the checked ones. The rules of the narrowing are pure; the list is drawn here.

import { truncateTitle } from '../conversations/text';
import type { ConversationLike } from '../conversations/pagination';

export const NO_PROJECT_FILTER = '__none__';

export interface BatchConversation extends ConversationLike {
  title?: string;
  projectId?: string;
  project_id?: string;
}

/** The project a conversation belongs to, trimmed; empty for a conversation outside every project. */
export function projectIdOf(conversation: { projectId?: unknown; project_id?: unknown } | null | undefined): string {
  return String(conversation?.projectId || conversation?.project_id || '').trim();
}

/**
 * The conversations the dialog shows: those of the chosen project (or those outside every project for the "none" choice),
 * whose title or project name contains the search text. The search is case-insensitive.
 */
export function filterBatchConversations<T extends BatchConversation>(
  conversations: readonly T[],
  query: string,
  projectFilter: string,
  projectLabel: (conversation: T) => string,
): T[] {
  const search = (query || '').trim().toLowerCase();
  const chosen = (projectFilter || '').trim();
  return conversations.filter(conversation => {
    const pid = projectIdOf(conversation);
    if (chosen) {
      if (chosen === NO_PROJECT_FILTER) {
        if (pid) return false;
      } else if (pid !== chosen) {
        return false;
      }
    }
    if (!search) return true;
    const title = String(conversation.title || '').toLowerCase();
    const name = projectLabel(conversation).toLowerCase();
    return title.includes(search) || name.includes(search);
  });
}

/** The label of a conversation's project: its name, "no project", or "unknown project" for an id without a name. */
export function projectLabelOf(
  conversation: BatchConversation,
  names: Record<string, string>,
  texts: { noProject: string; unknownProject: string },
): string {
  const pid = projectIdOf(conversation);
  if (!pid) return texts.noProject;
  return names[pid] || texts.unknownProject;
}

/** The count in the dialog's title, which carries the number of rows shown. */
export function titleWithCount(template: string, count: number): string {
  const parts = template.split('__C__');
  return (parts[0] || '') + '<span id="batch-manage-count">' + (count || 0) + '</span>' + (parts[1] || '');
}

/** The checkbox of "select all" for a number of rows and checked rows: all, some (indeterminate), or none. */
export function selectAllState(total: number, checked: number): { checked: boolean; indeterminate: boolean } {
  if (total === 0 || checked === 0) return { checked: false, indeterminate: false };
  if (checked === total) return { checked: true, indeterminate: false };
  return { checked: false, indeterminate: true };
}

export function truncateName(title: string): string {
  return truncateTitle(title, 36);
}

export function truncateProject(label: string): string {
  return truncateTitle(label, 28);
}
