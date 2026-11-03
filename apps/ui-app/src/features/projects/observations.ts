import type { ProjectsContext } from './context';
import type { RuntimeObservation } from './types';
import { esc } from './dom';
import { HttpError } from '../../platform/http';

export function createProjectObservations(ctx: ProjectsContext) {
  const { dom, service, deps } = ctx;
  let observations: RuntimeObservation[] = [], projectId = '', sequence = 0;
  function reset() { ++sequence; observations = []; projectId = ''; dom.text('project-observation-results', ''); }
  async function load() {
    const id = service.state.selectedId, seq = ++sequence;
    projectId = ''; observations = [];
    dom.text('project-observation-results', dom.t('common.loading'));
    try {
      const response = await service.api.observations(id, dom.value('project-observation-kind'), dom.value('project-observation-search'));
      if (seq !== sequence || id !== service.state.selectedId) return;
      projectId = id; observations = response.nodes;
      dom.html('project-observation-results', observations.length ? observations.map((node, index) => `<details><summary><label><input type="checkbox" name="graph-observation" value="${index}"> ${esc(node.kind)}: ${esc(node.label || node.key)}</label> — ${esc(node.props.provenance_channel || 'legacy_unknown')}</summary><pre class="fact-detail-body">${esc(JSON.stringify(node, null, 2))}</pre></details>`).join('') + (response.truncated ? `<p>${esc(dom.fmt('projects.graphTruncated', 'Showing a bounded selection. Narrow the search for more results.'))}</p>` : '') : esc(dom.fmt('projects.noObservations', 'No matching observations in this project.')));
    } catch (error) {
      if (seq === sequence) dom.text('project-observation-results', dom.fmt('projects.observationLoadFailed', 'Could not load observations. Check runtime connectivity and retry.'));
      throw error;
    }
  }
  async function propose() {
    if (!deps.requirePermission('project:write') || projectId !== service.state.selectedId) return;
    const selected = [...dom.document.querySelectorAll<HTMLInputElement>('input[name="graph-observation"]:checked')].map(input => observations[Number(input.value)]).filter((node): node is RuntimeObservation => !!node);
    const factKey = dom.value('project-observation-fact-key').trim();
    if (!selected.length || !factKey) return deps.notify(dom.fmt('projects.selectObservationAndKey', 'Select evidence and enter a fact key.'), 'error');
    const id = projectId;
    const fact = await service.api.fact(id, factKey).catch(error => { if (error instanceof HttpError && error.status === 404) return null; throw error; });
    await service.api.proposeFact(id, { fact_key: factKey, summary: dom.value('project-observation-summary').trim() || selected[0]!.label, observations: selected.map(({ kind, key, snapshot_hash }) => ({ kind, key, snapshot_hash })), ...(fact?.revision ? { expected_revision: fact.revision } : {}) });
    if (id !== service.state.selectedId) return;
    deps.notify(dom.fmt('projects.observationProposed', 'Finding proposed with retained evidence. Review it before verification.'), 'success');
    await ctx.refreshFacts();
  }
  return { reset, load, propose };
}
