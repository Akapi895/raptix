// Skinned replacements for the native selects of the session settings card. The native select stays in the
// DOM (hidden) and remains the source of truth; the skin mirrors its options and forwards choices to it.

export interface SessionSelectSkin {
  /** Skins every select in the settings panel, and wires the document-level dismissal once. */
  init(panel: HTMLElement | null): void;
  /** Re-syncs every skinned select with its native select. */
  refresh(): void;
  dispose(): void;
}

interface Skin {
  wrapper: HTMLElement;
  trigger: HTMLButtonElement;
  value: HTMLElement;
  menu: HTMLElement;
}

export function sessionSelectLabel(option: HTMLOptionElement | undefined): string {
  return option ? (option.textContent || option.label || option.value || '') : '';
}

export function createSessionSelectSkin(doc: Document): SessionSelectSkin {
  const skins = new Map<HTMLSelectElement, Skin>();
  const lifecycle = new AbortController();
  let docBound = false;
  const onDocClick = () => closeAll();
  const onDocKey = (event: KeyboardEvent) => { if (event.key === 'Escape') closeAll(); };

  function sync(select: HTMLSelectElement): void {
    const skin = skins.get(select);
    if (!skin) return;
    const selected = select.options[select.selectedIndex];
    skin.value.textContent = sessionSelectLabel(selected);
    (skin.trigger as HTMLButtonElement).disabled = select.disabled;
    skin.wrapper.classList.toggle('is-disabled', select.disabled);
    skin.menu.innerHTML = '';
    Array.from(select.options).forEach((option, index) => {
      const item = doc.createElement('button');
      item.type = 'button';
      item.className = 'session-settings-select-option';
      item.setAttribute('role', 'option');
      item.setAttribute('data-index', String(index));
      item.setAttribute('aria-selected', option.selected ? 'true' : 'false');
      item.disabled = option.disabled;
      item.classList.toggle('is-selected', option.selected);
      const label = doc.createElement('span');
      label.className = 'session-settings-select-option-label';
      label.textContent = sessionSelectLabel(option);
      item.appendChild(label);
      skin.menu.appendChild(item);
    });
  }

  function close(select: HTMLSelectElement): void {
    const skin = skins.get(select);
    if (!skin) return;
    skin.wrapper.classList.remove('open');
    skin.trigger.setAttribute('aria-expanded', 'false');
  }

  function closeAll(): void {
    skins.forEach((_skin, select) => close(select));
  }

  /** Moves the chosen option into the native select and tells listeners, as a user choice would. */
  function choose(select: HTMLSelectElement, index: number): void {
    const option = select.options[index];
    if (option && !option.disabled && select.value !== option.value) {
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    sync(select);
  }

  function enhance(select: HTMLSelectElement): void {
    if (select.dataset.sessionSettingsSelect === '1') {
      sync(select);
      return;
    }
    if (!select.closest('.conversation-reasoning-card')) return;
    select.dataset.sessionSettingsSelect = '1';
    select.classList.add('session-settings-native-select');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');

    const wrapper = doc.createElement('div');
    wrapper.className = 'session-settings-select';
    const trigger = doc.createElement('button');
    trigger.type = 'button';
    trigger.className = 'session-settings-select-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    const value = doc.createElement('span');
    value.className = 'session-settings-select-value';
    const caret = doc.createElement('span');
    caret.className = 'session-settings-select-caret';
    caret.setAttribute('aria-hidden', 'true');
    caret.textContent = '⌄';
    trigger.append(value, caret);
    const menu = doc.createElement('div');
    menu.className = 'session-settings-select-menu';
    menu.setAttribute('role', 'listbox');

    select.parentNode?.insertBefore(wrapper, select);
    wrapper.append(trigger, menu, select);
    skins.set(select, { wrapper, trigger, value, menu });

    trigger.addEventListener('click', event => {
      event.stopPropagation();
      if (select.disabled) return;
      const willOpen = !wrapper.classList.contains('open');
      closeAll();
      wrapper.classList.toggle('open', willOpen);
      trigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });

    trigger.addEventListener('keydown', event => {
      if (select.disabled) return;
      const enabled = Array.from(select.options).filter(option => !option.disabled);
      if (enabled.length === 0) return;
      const current = Math.max(0, enabled.indexOf(select.options[select.selectedIndex]!));
      let next = current;
      if (event.key === 'ArrowDown') next = Math.min(enabled.length - 1, current + 1);
      else if (event.key === 'ArrowUp') next = Math.max(0, current - 1);
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = enabled.length - 1;
      else if (event.key === 'Escape') { close(select); return; }
      else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        wrapper.classList.add('open');
        trigger.setAttribute('aria-expanded', 'true');
        return;
      } else return;
      event.preventDefault();
      const chosen = enabled[next];
      if (chosen && select.value !== chosen.value) {
        select.value = chosen.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      sync(select);
    });

    menu.addEventListener('click', event => {
      const item = (event.target as Element).closest<HTMLButtonElement>('.session-settings-select-option');
      if (!item || item.disabled) return;
      event.stopPropagation();
      choose(select, Number(item.dataset.index));
      close(select);
    });

    select.addEventListener('change', () => sync(select), { signal: lifecycle.signal });
    sync(select);
  }

  return {
    init(panel) {
      if (!panel) return;
      panel.querySelectorAll('select').forEach(select => enhance(select as HTMLSelectElement));
      if (!docBound) {
        docBound = true;
        doc.addEventListener('click', onDocClick);
        doc.addEventListener('keydown', onDocKey);
      }
    },
    refresh(): void {
      skins.forEach((_skin, select) => sync(select));
    },
    dispose(): void {
      closeAll();
      lifecycle.abort();
      if (docBound) {
        doc.removeEventListener('click', onDocClick);
        doc.removeEventListener('keydown', onDocKey);
        docBound = false;
      }
      skins.forEach((skin, select) => {
        skin.wrapper.before(select); skin.wrapper.remove();
        delete select.dataset.sessionSettingsSelect;
        select.classList.remove('session-settings-native-select');
        select.removeAttribute('aria-hidden'); select.removeAttribute('tabindex');
      });
      skins.clear();
    },
  };
}
