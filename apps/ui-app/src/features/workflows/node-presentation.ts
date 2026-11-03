import { escapeHtml as esc } from './dom';

export const nodePresentation: Record<string, { color: string; tint: string; path: string; description: string }> = {
  start: { color: '#277654', tint: '#edf7f0', path: '<path d="m9 5 10 7-10 7V5Z"/>', description: 'Define the workflow inputs' },
  tool: { color: '#34649b', tint: '#edf3fa', path: '<path d="m8 6-5 6 5 6m8-12 5 6-5 6m-3-15-2 18"/>', description: 'Run a configured MCP tool' },
  agent: { color: '#73559d', tint: '#f3eff8', path: '<rect x="4" y="7" width="16" height="13" rx="3"/><path d="M12 3v4M8 12h.01M16 12h.01M8 16h8"/>', description: 'Delegate work to an AI agent' },
  condition: { color: '#92641c', tint: '#fcf5e8', path: '<path d="m12 3 9 9-9 9-9-9 9-9Z M12 8v5m0 3h.01"/>', description: 'Branch on a true or false result' },
  hitl: { color: '#a15b32', tint: '#fcf1e9', path: '<path d="M12 3 4 7v6c0 4 8 8 8 8s8-4 8-8V7l-8-4Z m-4 9 3 3 5-6"/>', description: 'Request a human or agent review' },
  output: { color: '#35777b', tint: '#edf6f6', path: '<path d="M13 4h7v16H4V4h5m3-2v12m-4-4 4 4 4-4"/>', description: 'Publish a named workflow result' },
  end: { color: '#647083', tint: '#f0f2f5', path: '<rect x="5" y="5" width="14" height="14" rx="3"/><path d="M9 9h6v6H9z"/>', description: 'Finish with a result binding' },
};
export function nodeIcon(type: string): string {
  const p = nodePresentation[type] ?? nodePresentation.tool!;
  return `<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${p.color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="background:${p.tint}">${p.path}</svg>`;
}
export function nodeBackground(type: string, name: string): string {
  const p = nodePresentation[type] ?? nodePresentation.tool!;
  const terminal = ['start', 'end'].includes(type), condition = type === 'condition';
  const width = terminal ? 152 : condition ? 220 : 204;
  const height = terminal ? 64 : condition ? 120 : 80;
  const x = condition ? 70 : terminal ? 30 : 16, y = condition ? 32 : 12;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g transform="translate(${x},${y})"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${p.color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${p.path}</svg><text x="26" y="13" font-family="Arial,sans-serif" font-size="10" font-weight="600" fill="${p.color}">${esc(name)}</text></g></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
