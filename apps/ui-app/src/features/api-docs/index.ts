import { createActions, type ActionHandler } from '../../ui/actions';
import { groupsOf, buildCurl, endpointsOf, escapeId, pathParamNames, requestPath, withQuery, type OpenApiSpec, type Endpoint, tagKeyMap } from './model';
import { createApiDocsView, type ApiDocsText } from './view';

export * from './model';
export { createApiDocsView } from './view';

export interface ApiDocsDependencies {
  doc: Document;
  /** The current token: the stored session first, then the older swagger key. */
  readToken(): string | null;
  request(url: string, init?: RequestInit): Promise<Response>;
  origin(): string;
  t: ApiDocsText;
  copy(text: string): Promise<void>;
  alert(message: string): void;
  /** Re-applies the page's translations after a language change. */
  applyTranslations(root: Document): void;
  /** Milliseconds before the copy button restores its label. */
  copiedMs?: number;
}

export interface ApiDocsFeature {
  /** Fetches the spec and renders the page. */
  load(): Promise<void>;
  /** Binds the page's actions and the language listener. */
  activate(): void;
  dispose(): void;
}

/** The API documentation page. Its state is the spec and the token the page was opened with. */
export function initApiDocs(deps: ApiDocsDependencies): ApiDocsFeature {
  const { doc, t } = deps;
  const byId = (id: string) => doc.getElementById(id);
  let spec: OpenApiSpec | null = null;
  let token: string | null = null;
  let tagKeys: Record<string, string> = {};
  let activeGroup = 'all';
  let disposed = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const tagLabel = (tag: string): string => {
    if (!tag) return tag;
    const key = tagKeys[tag];
    if (!key) return tag;
    const i18nKey = `apiDocs.tags.${key}`;
    const translated = t(i18nKey);
    return translated === i18nKey ? tag : translated;
  };
  const summaryOf = (op: Endpoint): string => {
    const key = op['x-i18n-summary'];
    if (key) return t(`apiDocs.summary.${key}`);
    return op.summary ?? '';
  };
  const responseDescriptionOf = (resp: unknown): string => {
    const r = resp as { 'x-i18n-description'?: string; description?: string } | undefined;
    if (!r) return '';
    if (r['x-i18n-description']) return t(`apiDocs.response.${r['x-i18n-description']}`);
    return r.description ?? '';
  };

  const view = createApiDocsView(() => spec ?? {}, t, tagLabel, summaryOf, responseDescriptionOf);

  function showError(message: string): void {
    const main = byId('api-docs-main');
    if (main) main.innerHTML = view.error(message);
  }

  function renderAuthInfo(): void {
    const section = byId('auth-info-section');
    if (section) section.style.display = 'block';
    const status = byId('token-status');
    if (!status) return;
    status.style.display = 'block';
    if (!token) {
      status.innerHTML = `<p style="margin: 0; font-size: 0.8125rem;"></p>`;
      status.firstElementChild!.textContent = t('apiDocs.tokenNotDetected');
    }
  }

  function renderSidebar(): void {
    const list = byId('api-group-list');
    if (!list || !spec) return;
    while (list.children.length > 1) list.removeChild(list.lastChild!);
    list.insertAdjacentHTML('beforeend', view.sidebar(groupsOf(spec), activeGroup));
  }

  function renderEndpoints(group: string | null): void {
    const main = byId('api-docs-main');
    if (!main || !spec) return;
    main.innerHTML = view.endpoints(endpointsOf(spec, group));
  }

  function render(): void {
    if (!spec || !spec.paths) {
      showError(t('apiDocs.errorSpecInvalid'));
      return;
    }
    renderAuthInfo();
    renderSidebar();
    renderEndpoints(activeGroup === 'all' ? null : activeGroup);
  }

  async function load(): Promise<void> {
    token = deps.readToken();
    try {
      const response = await deps.request('/api/openapi/spec', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!response.ok) {
        if (response.status === 401) {
          showError(t('apiDocs.errorLoginRequired'));
          return;
        }
        throw new Error(t('apiDocs.errorLoadSpec') + response.status);
      }
      spec = await response.json() as OpenApiSpec;
      tagKeys = tagKeyMap(spec);
    } catch (error) {
      console.error('Failed to load the API spec:', error);
      showError(t('apiDocs.errorLoadFailed') + (error instanceof Error ? error.message : String(error)));
      return;
    }
    render();
  }

  /** Path and query values typed into the test form, read with the same ids the view wrote. */
  function valueOf(id: string): string | undefined {
    const input = byId(id) as HTMLInputElement | HTMLTextAreaElement | null;
    return input ? input.value : undefined;
  }

  function resultBox(key: string): HTMLElement | null {
    return byId(`test-result-${key}`);
  }

  function pathValues(path: string, method: string): Record<string, string> {
    const key = `${escapeId(path)}-${method}`;
    const values: Record<string, string> = {};
    for (const name of pathParamNames(path)) values[name] = valueOf(`test-param-${name}-${key}`) ?? '';
    return values;
  }

  function queryPairs(path: string, method: string): [string, string][] {
    const key = `${escapeId(path)}-${method}`;
    const pairs: [string, string][] = [];
    for (const param of spec?.paths?.[path]?.[method.toLowerCase() as 'get']?.parameters ?? []) {
      if (param.in !== 'query') continue;
      const value = valueOf(`test-query-${param.name}-${key}`);
      if (value !== undefined && value !== '') pairs.push([param.name, value]);
      else if (param.required) throw new Error(t('apiDocs.errorQueryParamRequired', { name: param.name }));
    }
    return pairs;
  }

  async function send(method: string, path: string): Promise<void> {
    const key = `${escapeId(path)}-${method}`;
    const box = resultBox(key);
    if (!box) return;
    box.style.display = 'block';
    box.className = 'api-test-result loading';
    box.textContent = t('apiDocs.sendingRequest');
    try {
      for (const name of pathParamNames(path)) {
        if (!valueOf(`test-param-${name}-${key}`)) throw new Error(t('apiDocs.errorPathParamRequired', { name }));
      }
      const url = withQuery(requestPath(path, pathValues(path, method)), queryPairs(path, method));
      if (!token) throw new Error(t('apiDocs.errorTokenRequired'));
      const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } };
      if (['POST', 'PUT', 'PATCH'].includes(method)) {
        const body = valueOf(`test-body-${key}`)?.trim();
        if (body) {
          try {
            init.body = JSON.stringify(JSON.parse(body));
          } catch (error) {
            throw new Error(t('apiDocs.errorJsonInvalid') + (error as Error).message);
          }
        }
      }
      const response = await deps.request(url, init);
      const text = await response.text();
      let data: unknown = text;
      try { data = JSON.parse(text); } catch { /* Plain text body. */ }
      box.className = response.ok ? 'api-test-result success' : 'api-test-result error';
      box.textContent = `Status code: ${response.status} ${response.statusText}\n\n${typeof data === 'string' ? data : JSON.stringify(data, null, 2)}`;
    } catch (error) {
      box.className = 'api-test-result error';
      box.textContent = t('apiDocs.requestFailed') + (error instanceof Error ? error.message : String(error));
    }
  }

  function flashButton(button: HTMLElement | null, label: string): void {
    if (!button) {
      deps.alert(t('apiDocs.curlCopied'));
      return;
    }
    const original = button.innerHTML;
    button.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>${label}`;
    button.style.color = 'var(--success-color)';
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (disposed) return;
      button.innerHTML = original;
      button.style.color = '';
    }, deps.copiedMs ?? 2000);
    timers.add(timer);
  }

  async function copyCurl(button: HTMLElement | null, method: string, path: string): Promise<void> {
    const url = withQuery(requestPath(path, pathValues(path, method)), (() => {
      try { return queryPairs(path, method); } catch { return []; }
    })());
    const body = ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase()) ? valueOf(`test-body-${escapeId(path)}-${method}`) ?? null : null;
    const command = buildCurl(deps.origin(), method, url, token, body);
    try {
      await deps.copy(command);
      flashButton(button, t('apiDocs.copied'));
    } catch (error) {
      console.error('Copy failed:', error);
      deps.alert(t('apiDocs.copyFailedManual') + command);
    }
  }

  const actions = createActions();
  const disposers: (() => void)[] = [];
  const handlers: Record<string, ActionHandler> = {
    'apiDocs.group': (element, event) => {
      event.preventDefault();
      activeGroup = element.dataset.group ?? 'all';
      byId('api-group-list')?.querySelectorAll('.api-group-link').forEach(link => { link.classList.remove('active'); link.removeAttribute('aria-current'); });
      element.classList.add('active');
      element.setAttribute('aria-current', 'true');
      renderEndpoints(activeGroup === 'all' ? null : activeGroup);
    },
    'apiDocs.toggleDescription': element => {
      const detail = element.parentElement?.querySelector<HTMLElement>('.api-description-detail');
      const icon = element.querySelector<HTMLElement>('.description-toggle-icon');
      const label = element.querySelector('span');
      if (!detail || !icon || !label) return;
      const open = detail.style.display === 'none';
      detail.style.display = open ? 'block' : 'none';
      element.setAttribute('aria-expanded', String(open));
      icon.style.transform = open ? 'rotate(180deg)' : 'rotate(0deg)';
      label.textContent = t(open ? 'apiDocs.hideDetailDesc' : 'apiDocs.viewDetailDesc');
    },
    'apiDocs.send': element => { void send(element.dataset.method ?? 'GET', element.dataset.path ?? ''); },
    'apiDocs.copyCurl': element => { void copyCurl(element, element.dataset.method ?? 'GET', element.dataset.path ?? ''); },
    'apiDocs.clear': element => {
      const box = resultBox(element.dataset.key ?? '');
      if (box) {
        box.style.display = 'none';
        box.textContent = '';
      }
    },
    'apiDocs.toggleAuth': element => {
      const body = byId('auth-info-body');
      const arrow = byId('auth-info-arrow');
      if (!body || !arrow) return;
      const expanded = body.style.display !== 'none';
      body.style.display = expanded ? 'none' : 'block';
      element.setAttribute('aria-expanded', String(!expanded));
      arrow.style.transform = expanded ? 'rotate(0deg)' : 'rotate(180deg)';
    },
  };

  let unbind: (() => void) | undefined;
  const onLanguage = () => {
    if (disposed) return;
    deps.applyTranslations(doc);
    if (spec) render();
  };

  return {
    load,
    activate(): void {
      if (unbind) return;
      disposers.push(...Object.entries(handlers).map(([name, handler]) => actions.register(name, handler)));
      unbind = actions.bind(doc);
      doc.addEventListener('languagechange', onLanguage);
    },
    dispose(): void {
      disposed = true;
      timers.forEach(timer => clearTimeout(timer));
      timers.clear();
      unbind?.();
      unbind = undefined;
      disposers.forEach(dispose => dispose());
      doc.removeEventListener('languagechange', onLanguage);
    },
  };
}
