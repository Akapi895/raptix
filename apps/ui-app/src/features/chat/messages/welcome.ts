// The welcome of an empty chat: the line under the title and the title itself, which names the project in use.

import type { Translate } from './text';

/** The text of the welcome subtitle: a project-specific line, or the generic one when there is no project. */
export function welcomeText(projectName: string, noProjectName: string, t: Translate): string {
  if (!projectName || projectName === noProjectName) return t('chat.noProjectWelcomeMessage', 'No project is currently selected. Enter your test requirements and the system will run the corresponding security tests.');
  return t('chat.projectWelcomeMessage', `Project ${projectName} is active. Describe your testing needs and the system will run the matching security tests.`, { project: projectName });
}

/** Fills the welcome title: a question, or the question about the named project. */
export function renderWelcomeTitle(title: HTMLElement, projectName: string, noProjectName: string, t: Translate): void {
  const doc = title.ownerDocument;
  if (!projectName || projectName === noProjectName) {
    title.textContent = t('chat.noProjectWelcomeTitle', 'What should be tested?');
    return;
  }
  const projectElement = doc.createElement('span');
  projectElement.className = 'chat-welcome-project-name';
  projectElement.textContent = projectName;
  title.replaceChildren(
    doc.createTextNode(t('chat.projectWelcomeTitlePrefix', 'What should be tested in ')),
    projectElement,
    doc.createTextNode(t('chat.projectWelcomeTitleSuffix', '?')),
  );
}

/** Updates the subtitle and the title of the empty-state block that is on screen. */
export function updateWelcomeTitle(title: HTMLElement | null, projectName: string, noProjectName: string, t: Translate): void {
  if (!title) return;
  renderWelcomeTitle(title, projectName, noProjectName, t);
  const subtitle = title.parentElement?.querySelector<HTMLElement>('.chat-welcome-empty-state-subtitle');
  if (subtitle) subtitle.textContent = t('chat.welcomeSubtitle', 'Enter your test requirements and the system will automatically run the corresponding security tests.');
}
