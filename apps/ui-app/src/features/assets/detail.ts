import { action, createDOM, type ActionHandler } from './dom';
import { errorMessage, escapeHtml as e, type AssetsDependencies } from './contracts';
import { targetLabel, type Asset } from './model';
import type { AssetsService } from './service';
import { closeAppModal } from '../../ui/modal';
import { buildAssetGraph } from './intelligence';

/** The current contract retains the latest scan link, not an append-only scan ledger. */
export function createAssetEvidence(doc: Document, service: AssetsService, deps: AssetsDependencies, signal: AbortSignal) {
  const dom = createDOM(doc, signal);
  let request: AbortController | undefined, asset: Asset | null = null;
  const names = { overview: 'Overview', services: 'Services', findings: 'Findings', scans: 'Scan history', sitemap: 'Sitemap' };
  function tab(name: string) {
    for (const key of Object.keys(names)) {
      dom.hidden('asset-evidence-' + key, key !== name);
      const el = dom.get('asset-evidence-tab-' + key); el?.setAttribute('aria-selected', String(key === name)); el?.setAttribute('tabindex', key === name ? '0' : '-1');
    }
  }
  function mount(value: Asset) {
    request?.abort(); request = new AbortController(); const controller = request; asset = value;
    const grid = dom.get('asset-detail-grid'); if (!grid) return;
    const original = grid.innerHTML;
    grid.innerHTML = `<div class="asm-detail-tabs" role="tablist" aria-label="Asset details">${Object.entries(names).map(([key, label]) => `<button id="asset-evidence-tab-${key}" type="button" role="tab" aria-controls="asset-evidence-${key}" aria-selected="${key === 'overview'}" tabindex="${key === 'overview' ? 0 : -1}" ${action('evidence.tab', { tab: key })}>${label}</button>`).join('')}</div>
      <div id="asset-evidence-overview" role="tabpanel" aria-labelledby="asset-evidence-tab-overview">${original}</div>
      ${Object.keys(names).filter(key => key !== 'overview').map(key => `<section id="asset-evidence-${key}" class="asm-evidence-panel" role="tabpanel" aria-labelledby="asset-evidence-tab-${key}" hidden></section>`).join('')}`;
    grid.querySelector('.asm-detail-tabs')?.addEventListener('keydown', event => {
      if (!(event instanceof KeyboardEvent) || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const keys = Object.keys(names), current = keys.findIndex(key => dom.get('asset-evidence-tab-' + key) === doc.activeElement);
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? keys.length - 1 : (current + (event.key === 'ArrowLeft' ? -1 : 1) + keys.length) % keys.length;
      const key = keys[index]!; tab(key); dom.get('asset-evidence-tab-' + key)?.focus();
    }, { signal });
    const serviceRows = [value];
    renderServices(serviceRows);
    dom.html('asset-evidence-findings', '<p class="muted">Loading related findings…</p>');
    const date = value.last_scan_at ? new Date(value.last_scan_at).toLocaleString(deps.locale()) : '';
    dom.html('asset-evidence-scans', `<h3>Scan activity</h3><p class="muted">The backend retains the latest scan reference only. A linked execution does not confirm successful completion.</p>
      ${date || value.last_scan_task_id || value.last_scan_conversation_id ? `<div class="asm-scan-record"><strong>Latest recorded scan</strong><time>${e(date || 'Timestamp unavailable')}</time>
        ${value.last_scan_task_id ? `<p>Task <code>${e(value.last_scan_task_id)}</code></p>` : ''}
        ${value.last_scan_queue_id ? `<button class="btn-secondary" type="button" ${action('evidence.queue')}>Review task queue</button>` : ''}
        ${value.last_scan_conversation_id ? `<button class="btn-secondary" type="button" ${action('evidence.conversation')}>Review scan conversation</button>` : ''}</div>` : '<div class="asm-empty"><h4>No scan activity recorded</h4><p>Start a scan from the inventory to collect evidence for this asset.</p></div>'}`);
    const web = /^https?:/i.test(value.host) || /^https?$/i.test(value.protocol);
    dom.html('asset-evidence-sitemap', `<h3>Web sitemap</h3><div class="asm-empty"><h4>${web ? 'No crawl data available' : 'Sitemap is available for web assets'}</h4><p>${web ? 'The current asset API does not expose crawl URLs or parent–child page relationships. Host and service fields alone do not provide sitemap evidence.' : 'This record has no HTTP or HTTPS service.'}</p></div>`);
    if (!deps.can('vulnerability:read')) { dom.html('asset-evidence-findings', '<p class="muted">You do not have permission to read findings.</p>'); return; }
    const params = new URLSearchParams();
    if (value.project_id) params.set('project_id', value.project_id);
    void service.findings(params, controller.signal).then(findings => {
      if (controller.signal.aborted || signal.aborted) return;
      const matched = new Set(buildAssetGraph([value], findings).nodes.flatMap(node => node.findingId ? [node.findingId] : []));
      const related = findings.filter(f => matched.has(f.id) || ((f.project_id || '') === (value.project_id || '') && (value.last_scan_task_id ? f.task_id === value.last_scan_task_id : !!value.last_scan_conversation_id && f.conversation_id === value.last_scan_conversation_id)));
      dom.html('asset-evidence-findings', `<h3>Related findings</h3><p class="muted">Target matches use recorded addresses or endpoints. Scan-linked findings may include other targets in a shared scan.</p>${related.length ? `<ul class="asm-finding-list">${related.map(f => `<li><button ${action('evidence.finding', { id: f.id })} type="button">${e(f.title)}</button><span class="asset-risk asset-risk--${['critical', 'high', 'medium', 'low', 'info'].includes(f.severity) ? f.severity : 'unassessed'}">${e(f.severity)}</span><span>${e(f.status)}</span><small>${e(f.target || 'Target not recorded')} · ${matched.has(f.id) ? 'Recorded target match' : 'Latest scan association'}</small></li>`).join('')}</ul>` : '<div class="asm-empty"><h4>No related findings returned</h4><p>There are no recorded target matches or findings from the latest linked scan. The inventory risk and count remain as reported by the asset API.</p></div>'}`);
    }).catch(error => { if (!controller.signal.aborted && !signal.aborted) dom.html('asset-evidence-findings', `<p class="asm-error">Could not load findings: ${e(errorMessage(error))}</p>`); });
  }
  function renderServices(rows: Asset[]) {
    dom.html('asset-evidence-services', `<h3>Recorded service</h3><p class="muted">Service information saved on this asset record.</p>${rows.some(a => a.port || a.protocol || a.server) ? `<div class="asm-service-table"><table><thead><tr><th>Target</th><th>Port</th><th>Protocol</th><th>Fingerprint</th><th>Last seen</th></tr></thead><tbody>${rows.map(a => `<tr><td>${e(targetLabel(a))}</td><td>${a.port || '—'}</td><td>${e(a.protocol || 'Unknown')}</td><td>${e(a.server || 'Not recorded')}</td><td>${e(a.last_seen_at ? new Date(a.last_seen_at).toLocaleString(deps.locale()) : 'Not recorded')}</td></tr>`).join('')}</tbody></table></div>` : '<p>No service information recorded.</p>'}`);
  }
  signal.addEventListener('abort', () => request?.abort(), { once: true });
  return { mount, cancel() { request?.abort(); }, handlers: {
    'evidence.tab': el => tab(el.dataset.tab || 'overview'),
    'evidence.finding': el => { closeAppModal('asset-detail-modal'); deps.setHash('vulnerabilities?id=' + encodeURIComponent(el.dataset.id || '')); },
    'evidence.conversation': () => { if (asset?.last_scan_conversation_id) { closeAppModal('asset-detail-modal'); return deps.navigateConversation(asset.last_scan_conversation_id); } },
    'evidence.queue': () => { if (asset?.last_scan_queue_id) { closeAppModal('asset-detail-modal'); deps.switchPage('tasks'); deps.showQueue(asset.last_scan_queue_id); } },
  } satisfies Record<string, ActionHandler> };
}
