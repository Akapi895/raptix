// A project name on the chat page is shortened for display only; the stored name is never changed.

export const PROJECT_NAME_DISPLAY_MAX_CHARACTERS = 12;

export function formatProjectNameForDisplay(value: unknown): string {
  const fullName = String(value == null ? '' : value);
  const characters = Array.from(fullName);
  if (characters.length <= PROJECT_NAME_DISPLAY_MAX_CHARACTERS) return fullName;
  return `${characters.slice(0, PROJECT_NAME_DISPLAY_MAX_CHARACTERS).join('')}…`;
}

/** Shows a project name in an element, keeping the full name in its dataset and its tooltip. */
export function applyProjectDisplayName(element: HTMLElement | null, value: unknown, fallback = ''): string {
  if (!element) return '';
  const fullName = String(value || fallback || '');
  element.textContent = formatProjectNameForDisplay(fullName);
  element.dataset.fullName = fullName;
  element.title = fullName;
  return fullName;
}
