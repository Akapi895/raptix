/** Normalize links on the feature's explicit action controls. */
export function bindSettingsStaticActions(doc: Document): void {
  for (const element of doc.querySelectorAll<HTMLElement>('[data-settings-action]')) {
    if (element.getAttribute('href')?.startsWith('javascript:')) element.setAttribute('href', '#');
  }
}
