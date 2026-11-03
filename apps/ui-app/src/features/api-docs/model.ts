// OpenAPI spec as served by internal/handler/openapi.go, with the Raptix extensions (x-i18n-*).
export interface SpecSchema {
  type?: string; $ref?: string; properties?: Record<string, SpecSchema>; required?: string[];
  items?: SpecSchema; enum?: unknown[]; example?: unknown; description?: string; default?: unknown;
}
export interface SpecParameter {
  name: string; in: string; required?: boolean; description?: string; schema?: SpecSchema;
}
export interface SpecResponse {
  description?: string; 'x-i18n-description'?: string; content?: Record<string, { schema?: SpecSchema }>;
}
export interface SpecOperation {
  operationId?: string; summary?: string; description?: string; tags?: string[];
  'x-i18n-tags'?: string[]; 'x-i18n-summary'?: string;
  parameters?: SpecParameter[];
  requestBody?: { description?: string; content?: Record<string, { schema?: SpecSchema }> };
  responses?: Record<string, SpecResponse>;
}
export interface OpenApiSpec {
  paths?: Record<string, Record<string, SpecOperation>>;
  components?: { schemas?: Record<string, SpecSchema> };
}

export const METHODS = ['get', 'post', 'put', 'delete', 'patch'] as const;
export const BODY_METHODS = ['POST', 'PUT', 'PATCH'];

export interface Endpoint extends SpecOperation { path: string; method: string }

/** Maps each tag to its translation key, from the x-i18n-tags the server attaches to operations. */
export function tagKeyMap(spec: OpenApiSpec): Record<string, string> {
  const map: Record<string, string> = {};
  for (const path of Object.keys(spec.paths ?? {})) {
    const item = spec.paths?.[path];
    if (!item) continue;
    for (const method of METHODS) {
      const op = item[method];
      if (!op?.tags || !op['x-i18n-tags']) continue;
      op.tags.forEach((tag, i) => {
        const key = op['x-i18n-tags']?.[i];
        if (typeof key === 'string') map[tag] = key;
      });
    }
  }
  return map;
}

export function endpointsOf(spec: OpenApiSpec, group: string | null): Endpoint[] {
  const list: Endpoint[] = [];
  for (const path of Object.keys(spec.paths ?? {})) {
    const item = spec.paths?.[path] ?? {};
    for (const method of Object.keys(item)) {
      const op = item[method];
      if (!op) continue;
      const tags = op.tags ?? [];
      if (!group || group === 'all' || tags.includes(group)) list.push({ ...op, path, method });
    }
  }
  return list.sort((a, b) => {
    const ta = a.tags?.[0] ?? '';
    const tb = b.tags?.[0] ?? '';
    if (ta !== tb) return ta.localeCompare(tb);
    return a.path.localeCompare(b.path);
  });
}

export function groupsOf(spec: OpenApiSpec): string[] {
  const groups = new Set<string>();
  for (const path of Object.keys(spec.paths ?? {})) {
    for (const op of Object.values(spec.paths?.[path] ?? {})) {
      (op?.tags ?? []).forEach(tag => groups.add(tag));
    }
  }
  return [...groups].sort();
}

/** The id fragment used for a path's test inputs: braces dropped, slashes made dashes. */
export function escapeId(text: string): string {
  return text.replace(/[{}]/g, '').replace(/\//g, '-');
}

export function pathParamNames(path: string): string[] {
  return (path.match(/\{([^}]+)\}/g) ?? []).map(param => param.slice(1, -1));
}

export function resolveSchema(spec: OpenApiSpec, schema: SpecSchema | undefined): SpecSchema {
  if (!schema) return {};
  if (schema.$ref) {
    const name = schema.$ref.split('/').pop() ?? '';
    return spec.components?.schemas?.[name] ?? schema;
  }
  return schema;
}

/** Example JSON for a body: the schema example when there is one, otherwise a sample built from the types. */
export function bodyExample(schema: SpecSchema, mode: 'typed' | 'loose' = 'typed'): string {
  if (schema.example) return JSON.stringify(schema.example, null, 2);
  if (!schema.properties) return '';
  const example: Record<string, unknown> = {};
  for (const key of Object.keys(schema.properties)) {
    const prop = schema.properties[key] ?? {};
    if (mode === 'loose') {
      example[key] = prop.example || (prop.type === 'string' ? '' : prop.type === 'number' ? 0 : prop.type === 'boolean' ? false : null);
      continue;
    }
    if (prop.example !== undefined) example[key] = prop.example;
    else if (prop.type === 'string') example[key] = prop.description || 'string';
    else if (prop.type === 'number') example[key] = 0;
    else if (prop.type === 'boolean') example[key] = false;
    else if (prop.type === 'array') example[key] = [];
    else example[key] = null;
  }
  return JSON.stringify(example, null, 2);
}

/** The API path a request is sent to: the spec path with parameters filled in and `/api` in front. */
export function requestPath(path: string, pathValues: Record<string, string>): string {
  let actual = path;
  for (const param of pathParamNames(path)) {
    const value = pathValues[param];
    if (value) actual = actual.replace(`{${param}}`, encodeURIComponent(value));
  }
  return actual.startsWith('/api') || actual.startsWith('http') ? actual : `/api${actual}`;
}

export function withQuery(path: string, pairs: [string, string][]): string {
  if (pairs.length === 0) return path;
  const query = pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  return path + (path.includes('?') ? '&' : '?') + query;
}

/** A curl command the user can run. Single quotes in the body are escaped for the shell. */
export function buildCurl(origin: string, method: string, path: string, token: string | null, body: string | null): string {
  let command = `curl -X ${method.toUpperCase()} "${origin}${path}"`;
  command += ` \\\n  -H "Content-Type: application/json"`;
  command += ` \\\n  -H "Authorization: Bearer ${token ?? 'YOUR_TOKEN_HERE'}"`;
  if (body && body.trim()) {
    let payload: string;
    try {
      payload = JSON.stringify(JSON.parse(body.trim()));
    } catch {
      payload = body.trim();
    }
    command += ` \\\n  -d '${payload.replace(/'/g, "'\\''")}'`;
  }
  return command;
}

export function escapeHtml(text: unknown): string {
  return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Renders the endpoint descriptions: fenced and inline code are protected first, then headings, emphasis,
 * links and lists are converted, and blank lines become paragraphs.
 */
export function formatDescription(text: string | undefined): string {
  if (!text) return '';
  let formatted = text;
  const blocks: { lang: string; code: string }[] = [];
  formatted = formatted.replace(/```(\w+)?\s*\n?([\s\S]*?)```/g, (_m, lang: string | undefined, code: string) => {
    blocks.push({ lang: (lang ?? '').trim(), code: code.trim() });
    return `__CODE_BLOCK_${blocks.length - 1}__`;
  });
  const inline: string[] = [];
  formatted = formatted.replace(/`([^`\n]+)`/g, (_m, code: string) => {
    inline.push(code);
    return `__INLINE_CODE_${inline.length - 1}__`;
  });
  formatted = escapeHtml(formatted);
  inline.forEach((code, i) => { formatted = formatted.replace(`__INLINE_CODE_${i}__`, `<code class="inline-code">${escapeHtml(code)}</code>`); });
  blocks.forEach((block, i) => {
    const label = block.lang ? `<span class="code-lang">${escapeHtml(block.lang)}</span>` : '';
    formatted = formatted.replace(`__CODE_BLOCK_${i}__`, `<pre class="code-block">${label}<code>${escapeHtml(block.code)}</code></pre>`);
  });
  // Descriptions live below the endpoint's h2 and section h3, not at page level.
  formatted = formatted.replace(/^###\s+(.+)$/gm, '<h6 class="md-h3">$1</h6>');
  formatted = formatted.replace(/^##\s+(.+)$/gm, '<h5 class="md-h2">$1</h5>');
  formatted = formatted.replace(/^#\s+(.+)$/gm, '<h4 class="md-h1">$1</h4>');
  formatted = formatted.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  formatted = formatted.replace(/__([^_]+?)__/g, '<strong>$1</strong>');
  formatted = formatted.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '<em>$1</em>');
  formatted = formatted.replace(/(?<!_)_([^_\n]+?)_(?!_)/g, '<em>$1</em>');
  formatted = formatted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="md-link">$1</a>');

  const lines = formatted.split('\n');
  const out: string[] = [];
  let ul = false;
  let ol = false;
  lines.forEach((line, i) => {
    const unordered = line.match(/^[-*]\s+(.+)$/);
    const ordered = line.match(/^\d+\.\s+(.+)$/);
    if (unordered) {
      if (ol) { out.push('</ol>'); ol = false; }
      if (!ul) { out.push('<ul class="md-list">'); ul = true; }
      out.push(`<li class="md-list-item">${unordered[1]}</li>`);
    } else if (ordered) {
      if (ul) { out.push('</ul>'); ul = false; }
      if (!ol) { out.push('<ol class="md-list">'); ol = true; }
      out.push(`<li class="md-list-item">${ordered[1]}</li>`);
    } else {
      if (ul) { out.push('</ul>'); ul = false; }
      if (ol) { out.push('</ol>'); ol = false; }
      if (line.trim()) out.push(line);
      else if (i < lines.length - 1) out.push('<br>');
    }
  });
  if (ul) out.push('</ul>');
  if (ol) out.push('</ol>');
  formatted = out.join('\n');
  formatted = formatted.replace(/(<br>\s*){2,}/g, '</p><p class="md-paragraph">');
  formatted = `<p class="md-paragraph">${formatted}</p>`;
  formatted = formatted.replace(/(<\/?(h[1-6]|ul|ol|li|pre|p)[^>]*>)\s*<br>/gi, '$1');
  formatted = formatted.replace(/<br>\s*(<\/?(h[1-6]|ul|ol|li|pre|p)[^>]*>)/gi, '$1');
  formatted = formatted.replace(/\n(?!<\/?(h[1-6]|ul|ol|li|pre|p|code))/g, '<br>');
  return formatted;
}
