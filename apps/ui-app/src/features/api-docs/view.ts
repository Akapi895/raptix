import { BODY_METHODS, bodyExample, escapeHtml, escapeId, formatDescription, resolveSchema, type Endpoint, type OpenApiSpec, type SpecParameter, type SpecSchema } from './model';

export interface ApiDocsText {
  (key: string, params?: Record<string, string | number>): string;
}

/** Escapes text for an attribute value. */
const attr = (value: unknown): string => escapeHtml(value).replace(/"/g, '&quot;');

/** The sidebar entries and the endpoint cards. Every control carries a data-action name, not an inline handler. */
export interface ApiDocsView {
  tagLabel(tag: string): string;
  sidebar(groups: string[], active: string): string;
  endpoints(endpoints: Endpoint[]): string;
  error(message: string): string;
}

export function createApiDocsView(spec: () => OpenApiSpec, t: ApiDocsText, tags: (tag: string) => string, summary: (op: Endpoint) => string, responseDescription: (resp: unknown) => string): ApiDocsView {
  const tagLabel = (tag: string) => tags(tag);

  function parameters(endpoint: Endpoint): string {
    const params = endpoint.parameters ?? [];
    if (params.length === 0) return '';
    const required = escapeHtml(t('apiDocs.required'));
    const optional = escapeHtml(t('apiDocs.optional'));
    const rows = params.map((param: SpecParameter) => `
      <tr>
        <td><span class="api-param-name">${escapeHtml(param.name)}</span></td>
        <td><span class="api-param-type">${escapeHtml(param.schema?.type || 'string')}</span></td>
        <td>${param.description ? escapeHtml(param.description).replace(/\n/g, '<br>') : '-'}</td>
        <td>${param.required ? `<span class="api-param-required">${required}</span>` : `<span class="api-param-optional">${optional}</span>`}</td>
      </tr>`).join('');
    return `
      <div class="api-section">
        <h3 class="api-section-title">${escapeHtml(t('apiDocs.sectionParams'))}</h3>
        <div class="api-table-wrapper">
          <table class="api-params-table">
            <thead><tr>
              <th>${escapeHtml(t('apiDocs.paramName'))}</th><th>${escapeHtml(t('apiDocs.type'))}</th>
              <th>${escapeHtml(t('apiDocs.description'))}</th><th>${required}</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  }

  function requestBody(endpoint: Endpoint): string {
    if (!endpoint.requestBody) return '';
    const schema = resolveSchema(spec(), endpoint.requestBody.content?.['application/json']?.schema);
    let table = '';
    if (schema.properties) {
      const requiredFields = schema.required ?? [];
      const req = escapeHtml(t('apiDocs.required'));
      const opt = escapeHtml(t('apiDocs.optional'));
      const rows = Object.keys(schema.properties).map(key => {
        const prop: SpecSchema = schema.properties?.[key] ?? {};
        let typeDisplay = prop.type || 'object';
        if (prop.type === 'array' && prop.items) typeDisplay = `array[${prop.items.type || 'object'}]`;
        else if (prop.$ref) typeDisplay = prop.$ref.split('/').pop() ?? '';
        if (prop.enum) typeDisplay += ` (${prop.enum.join(', ')})`;
        return `<tr>
          <td><span class="api-param-name">${escapeHtml(key)}</span></td>
          <td><span class="api-param-type">${escapeHtml(typeDisplay)}</span></td>
          <td>${prop.description ? escapeHtml(prop.description).replace(/\n/g, '<br>') : '-'}</td>
          <td>${requiredFields.includes(key) ? `<span class="api-param-required">${req}</span>` : `<span class="api-param-optional">${opt}</span>`}</td>
          <td>${prop.example !== undefined ? `<code>${escapeHtml(String(prop.example))}</code>` : '-'}</td>
        </tr>`;
      }).join('');
      if (rows) {
        table = `<div class="api-table-wrapper" style="margin-top: 12px;">
          <table class="api-params-table">
            <thead><tr>
              <th>${escapeHtml(t('apiDocs.paramName'))}</th><th>${escapeHtml(t('apiDocs.type'))}</th>
              <th>${escapeHtml(t('apiDocs.description'))}</th><th>${req}</th><th>${escapeHtml(t('apiDocs.example'))}</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
      }
    }
    const example = bodyExample(schema);
    return `
      <div class="api-section">
        <h3 class="api-section-title">${escapeHtml(t('apiDocs.sectionRequestBody'))}</h3>
        ${endpoint.requestBody.description ? `<div class="api-description">${escapeHtml(endpoint.requestBody.description)}</div>` : ''}
        ${table}
        ${example ? `<div style="margin-top: 16px;">
          <div style="font-weight: 500; margin-bottom: 8px; color: var(--text-primary);">${escapeHtml(t('apiDocs.exampleJson'))}</div>
          <div class="api-response-example"><pre>${escapeHtml(example)}</pre></div>
        </div>` : ''}
      </div>`;
  }

  function responses(endpoint: Endpoint): string {
    const entries = Object.keys(endpoint.responses ?? {}).map(status => {
      const response = endpoint.responses?.[status];
      const schema = response?.content?.['application/json']?.schema ?? {};
      const example = schema.example ? JSON.stringify(schema.example, null, 2) : '';
      const desc = responseDescription(response);
      const color = status.startsWith('2') ? 'var(--success-color)' : status.startsWith('4') ? 'var(--error-color)' : 'var(--warning-color)';
      return `<div style="margin-bottom: 16px;">
        <strong style="color: ${color}">${status}</strong>
        ${desc ? `<span style="color: var(--text-secondary); margin-left: 8px;">${escapeHtml(desc)}</span>` : ''}
        ${example ? `<div class="api-response-example" style="margin-top: 8px;"><pre>${escapeHtml(example)}</pre></div>` : ''}
      </div>`;
    }).join('');
    if (!entries) return '';
    return `<div class="api-section">
      <h3 class="api-section-title">${escapeHtml(t('apiDocs.sectionResponse'))}</h3>
      ${entries}
    </div>`;
  }

  function testSection(endpoint: Endpoint): string {
    const method = endpoint.method.toUpperCase();
    const path = endpoint.path;
    const key = `${escapeId(path)}-${method}`;
    const hasBody = !!endpoint.requestBody && BODY_METHODS.includes(method);
    const bodyDefault = hasBody ? bodyExample(resolveSchema(spec(), endpoint.requestBody?.content?.['application/json']?.schema), 'loose') : '';
    const body = hasBody ? `<div class="api-test-input-group">
        <label for="${attr(`test-body-${key}`)}">${escapeHtml(t('apiDocs.requestBodyJson'))}</label>
        <textarea id="${attr(`test-body-${key}`)}" class="test-body-input" placeholder="${attr(t('apiDocs.requestBodyPlaceholder'))}">${escapeHtml(bodyDefault)}</textarea>
      </div>` : '';
    const pathInputs = (endpoint.parameters ?? []).filter(p => p.in === 'path').map(param => `
      <div class="api-test-input-group">
        <label for="${attr(`test-param-${param.name}-${key}`)}">${escapeHtml(param.name)} <span style="color: var(--error-color);">*</span></label>
        <input type="text" id="${attr(`test-param-${param.name}-${key}`)}" placeholder="${attr(param.description || param.name)}" required>
      </div>`).join('');
    const queryInputs = (endpoint.parameters ?? []).filter(p => p.in === 'query').map(param => {
      const value = param.schema?.default !== undefined ? String(param.schema.default) : '';
      const numeric = param.schema?.type === 'number' || param.schema?.type === 'integer';
      const marker = param.required ? '<span style="color: var(--error-color);">*</span>' : `<span style="color: var(--text-muted);">${escapeHtml(t('apiDocs.optional'))}</span>`;
      return `<div class="api-test-input-group">
        <label for="${attr(`test-query-${param.name}-${key}`)}">${escapeHtml(param.name)} ${marker}</label>
        <input type="${numeric ? 'number' : 'text'}" id="${attr(`test-query-${param.name}-${key}`)}" placeholder="${attr(param.description || param.name)}" value="${attr(value)}" ${param.required ? 'required' : ''}>
      </div>`;
    }).join('');
    const hasQuery = queryInputs.length > 0;
    return `
      <div class="api-test-section">
        <h3 class="api-section-title">${escapeHtml(t('apiDocs.testSection'))}</h3>
        <div class="api-test-form">
          ${pathInputs}
          ${hasQuery ? `<div style="margin-top: 16px;"><div style="font-weight: 500; margin-bottom: 8px; color: var(--text-primary);">${escapeHtml(t('apiDocs.queryParams'))}</div>${queryInputs}</div>` : ''}
          ${body}
          <div class="api-test-buttons">
            <button type="button" class="api-test-btn primary" data-action="apiDocs.send" data-method="${attr(method)}" data-path="${attr(path)}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              ${escapeHtml(t('apiDocs.sendRequest'))}
            </button>
            <button type="button" class="api-test-btn copy-curl" data-action="apiDocs.copyCurl" data-method="${attr(method)}" data-path="${attr(path)}" title="${attr(t('apiDocs.copyCurlTitle'))}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" stroke="currentColor" stroke-width="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="2"/></svg>
              ${escapeHtml(t('apiDocs.copyCurl'))}
            </button>
            <button type="button" class="api-test-btn clear-result" data-action="apiDocs.clear" data-key="${attr(key)}" title="${attr(t('apiDocs.clearResultTitle'))}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              ${escapeHtml(t('apiDocs.clearResult'))}
            </button>
          </div>
           <div id="${attr(`test-result-${key}`)}" class="api-test-result" role="status" style="display: none;"></div>
        </div>
      </div>`;
  }

  function card(endpoint: Endpoint): string {
    const method = endpoint.method.toLowerCase();
    const descriptionId = `description-${escapeId(endpoint.path)}-${method}`;
    const tagHtml = (endpoint.tags ?? []).map(tag => `<span class="api-tag">${escapeHtml(tagLabel(tag))}</span>`).join('');
    const summaryText = summary(endpoint);
    const description = endpoint.description
      ? `<div class="api-description-toggle">
          <button type="button" class="description-toggle-btn" data-action="apiDocs.toggleDescription" aria-expanded="false" aria-controls="${attr(descriptionId)}">
            <svg class="description-toggle-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
            <span>${escapeHtml(t('apiDocs.viewDetailDesc'))}</span>
          </button>
          <div id="${attr(descriptionId)}" class="api-description-detail" style="display: none;">${formatDescription(endpoint.description)}</div>
        </div>`
      : endpoint.summary ? '' : `<div class="api-description">${escapeHtml(t('apiDocs.noDescription'))}</div>`;
    return `<div class="api-endpoint">
      <div class="api-endpoint-header">
        <h2 class="api-endpoint-title">
          <span class="api-method ${method}">${endpoint.method.toUpperCase()}</span>
          <span class="api-path">${escapeHtml(endpoint.path)}</span>
          ${tagHtml}
        </h2>
      </div>
      <div class="api-endpoint-body">
        <div class="api-section">
          <h3 class="api-section-title">${escapeHtml(t('apiDocs.sectionDescription'))}</h3>
          ${summaryText ? `<div class="api-description" style="font-weight: 500; margin-bottom: 8px; color: var(--text-primary);">${escapeHtml(summaryText)}</div>` : ''}
          ${description}
        </div>
        ${parameters(endpoint)}
        ${requestBody(endpoint)}
        ${responses(endpoint)}
        ${testSection(endpoint)}
      </div>
    </div>`;
  }

  return {
    tagLabel,
    sidebar(groups, active) {
      const items = groups.map(group => `<li class="api-group-item">
        <a href="#" class="api-group-link${active === group ? ' active' : ''}" ${active === group ? 'aria-current="true"' : ''} data-action="apiDocs.group" data-group="${attr(group)}">${escapeHtml(tagLabel(group))}</a>
      </li>`).join('');
      return items;
    },
    endpoints(endpoints) {
      if (endpoints.length === 0) {
        return `<div class="empty-state"><h2>${escapeHtml(t('apiDocs.noApis'))}</h2><p>${escapeHtml(t('apiDocs.noEndpointsInGroup'))}</p></div>`;
      }
      return endpoints.map(card).join('');
    },
    error(message) {
      return `<div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
        </svg>
        <h2>${escapeHtml(t('apiDocs.loadFailed'))}</h2>
        <p>${escapeHtml(message)}</p>
        <div style="margin-top: 16px;"><a href="/" style="color: var(--accent-color); text-decoration: none;">${escapeHtml(t('apiDocs.backToLogin'))}</a></div>
      </div>`;
    },
  };
}
