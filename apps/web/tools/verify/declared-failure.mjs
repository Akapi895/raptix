/** Whether the route's observed failure is covered by its declared baseline. */
export function isDeclaredFailure(entry, row) {
  if (['page-error', 'render-boundary', 'console-error', 'sign-in', 'no-expectation'].includes(row.category)) return false;
  if (!entry?.categories.includes(row.category)) return false;
  if (row.category !== 'api-error') return true;
  if (!Array.isArray(entry.apiErrors) || !row.apiFailures?.length) return false;
  return row.apiFailures.every((actual) => entry.apiErrors.some((expected) => {
    if (actual.method !== expected.method || !expected.statuses.includes(actual.status)) return false;
    const parts = new URL(actual.url).pathname.split('/');
    const pattern = expected.path.split('/');
    return parts.length === pattern.length && pattern.every((part, index) => part.startsWith(':') ? parts[index].length > 0 : part === parts[index]);
  }));
}
