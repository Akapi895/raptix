import { projectsBrowser as browser } from '../../platform/projects-browser';
import type { ProjectsContext } from './context';
import type { Fact, FactInput, VerificationState } from './types';
import { FACT_ATTACK_CHAIN_BODY_TEMPLATE, FACT_ENV_BODY_TEMPLATE, isSparseFactBody, requiresAttackChainFact } from './fact-body';
import { esc, formatProjectTime } from './dom';

export function createProjectForms(ctx: ProjectsContext) {
  const { service, deps, dom } = ctx, { t, fmt } = dom;
  let projectEditId = '', origin: 'projects' | 'chat' | 'sidebar' | 'webshell' = 'projects';
  let factEditId = '', detail: Fact | null = null;
  let projectSequence = 0, factSequence = 0, detailSequence = 0;
  let evidenceOffset = 0;
  const allowWrite = () => deps.requirePermission('project:write', fmt('projects.writePermissionDenied', 'This account is read-only and cannot create or edit projects'));
  function closeProjectModal() { ++projectSequence; projectEditId = ''; origin = 'projects'; deps.closeModal('project-modal'); }
  function showNewProjectModal(from: typeof origin = 'projects') {
    if (!allowWrite()) return;
    ++projectSequence; projectEditId = ''; origin = from;
    dom.text('project-modal-title', t('projects.modalNewTitle')); dom.text('project-modal-subtitle', t('projects.modalNewSubtitle'));
    dom.text('project-modal-submit-btn', t('projects.createProject')); dom.setValue('project-modal-name', ''); dom.setValue('project-modal-description', '');
    deps.openModal('project-modal');
  }
  async function showEditProjectModal(id: string, options: { fromChatSidebar?: boolean } = {}) {
    if (!id || !allowWrite()) return;
    const seq = ++projectSequence;
    projectEditId = id; origin = options.fromChatSidebar ? 'sidebar' : 'projects';
    dom.text('project-modal-title', t('projects.modalEditTitle')); dom.text('project-modal-subtitle', t('projects.modalEditSubtitle')); dom.text('project-modal-submit-btn', t('projects.saveChanges'));
    dom.setValue('project-modal-name', ''); dom.setValue('project-modal-description', ''); deps.openModal('project-modal', { focus: false });
    const project = service.findProjectById(id) ?? await service.fetchProjectSummary(id);
    if (seq !== projectSequence) return;
    if (!project) { closeProjectModal(); throw new Error(t('projects.projectNotFound')); }
    deps.deferModalContent(() => { if (seq !== projectSequence) return; dom.setValue('project-modal-name', project.name.slice(0, 200)); dom.setValue('project-modal-description', (project.description || '').trim().slice(0, 4000)); dom.field('project-modal-name')?.focus(); });
  }
  async function saveProjectModal() {
    if (!allowWrite()) return;
    const name = dom.value('project-modal-name').trim().slice(0, 200); if (!name) return browser.alert(t('projects.enterProjectName'));
    const button = dom.el('project-modal-submit-btn'); if (button instanceof HTMLButtonElement) button.disabled = true;
    const editId = projectEditId, from = origin;
    try {
      const saved = await service.saveProject(editId, { name, description: dom.value('project-modal-description').trim().slice(0, 4000) });
      // Selecting the new workspace must precede closing the modal: the next
      // click may already open a new chat while the project list is reloading.
      if (!editId && from === 'projects' && saved.id) service.setActiveProjectId(saved.id);
      closeProjectModal(); await ctx.reload();
      if (saved.id) {
        if (!editId && from === 'webshell') await deps.applyWebshellProjectSelection(saved.id);
        else if (!editId && from === 'chat') await ctx.applyChatProject(saved.id);
        else if (from !== 'sidebar') await ctx.select(saved.id);
      }
    } finally { if (button instanceof HTMLButtonElement) button.disabled = false; }
  }
  function formatProjectScopeJson() {
    const raw = dom.value('project-edit-scope').trim(); if (!raw) return;
    try { dom.setValue('project-edit-scope', JSON.stringify(JSON.parse(raw), null, 2)); }
    catch (error) { browser.alert(t('projects.invalidJson') + ': ' + String(error)); }
  }
  function insertProjectScopeExample() { dom.setValue('project-edit-scope', JSON.stringify({ targets: ['https://example.com'], exclude: ['*.cdn.example.com'], notes: t('projects.scopeNoteAuthorizedWebOnly') }, null, 2)); dom.field('project-edit-scope')?.focus(); }
  async function saveProjectSettings() {
    const id = service.state.selectedId; if (!id || !allowWrite()) return;
    const name = dom.value('project-edit-name').trim(); if (!name) return browser.alert(t('projects.enterProjectName'));
    const scope = dom.value('project-edit-scope').trim();
    try { if (scope) JSON.parse(scope); } catch (error) { return browser.alert(t('projects.invalidScopeJson') + ': ' + String(error)); }
    await service.saveProject(id, { name, description: dom.value('project-edit-description').trim().slice(0, 4000), scope_json: scope, status: dom.value('project-edit-status') || 'active', pinned: dom.checked('project-edit-pinned') });
    await ctx.reload(); await ctx.select(id); deps.notifyApiError(t('projects.saved'), 'success');
  }
  function updateFactFormHints() {
    const category = dom.value('fact-modal-category'), key = dom.value('fact-modal-key'), body = dom.value('fact-modal-body');
    const attack = requiresAttackChainFact(category, key), sparse = isSparseFactBody(category, key, body);
    dom.text('fact-modal-body-hint', t(attack ? sparse ? 'projects.factHintAttackSparse' : 'projects.factHintAttackReady' : 'projects.factHintEnv'));
    dom.el('fact-modal-body-hint')?.classList.toggle('projects-field-hint--warn', attack && sparse);
  }
  function insertFactBodyTemplate(kind: string) {
    if (dom.value('fact-modal-body').trim() && !browser.confirm(t('projects.confirmOverwriteBodyTemplate'))) return;
    dom.setValue('fact-modal-body', kind === 'env' ? FACT_ENV_BODY_TEMPLATE : FACT_ATTACK_CHAIN_BODY_TEMPLATE); updateFactFormHints(); dom.field('fact-modal-body')?.focus();
  }
  function resetFact() {
    factEditId = ''; const key = dom.field('fact-modal-key'); if (key) key.disabled = false;
    dom.text('fact-modal-title', t('projects.addFact')); dom.text('fact-modal-submit-btn', t('projects.saveFact'));
    for (const name of ['key', 'summary', 'body', 'related-vuln', 'links']) dom.setValue(`fact-modal-${name}`, '');
    dom.setValue('fact-modal-category', 'note'); dom.setValue('fact-modal-confidence', 'tentative'); dom.setChecked('fact-modal-pinned', false); dom.hidden('fact-modal-incoming-links-wrap', true); updateFactFormHints();
  }
  function fillFact(fact: Fact) {
    factEditId = fact.id; dom.text('fact-modal-title', t('projects.editFact')); dom.text('fact-modal-submit-btn', t('projects.saveChanges'));
    const category = dom.field('fact-modal-category');
    if (category instanceof HTMLSelectElement && ![...category.options].some(option => option.value === fact.category.trim().toLowerCase())) {
      const option = dom.document.createElement('option'); option.value = fact.category; option.textContent = fmt('projects.customCategoryOption', `${fact.category} (custom)`, { value: fact.category }); category.append(option);
    }
    dom.setValue('fact-modal-key', fact.fact_key); dom.setValue('fact-modal-category', fact.category || 'note'); dom.setValue('fact-modal-summary', fact.summary); dom.setValue('fact-modal-body', fact.body || '');
    dom.setValue('fact-modal-confidence', ['tentative', 'confirmed', 'deprecated'].includes(fact.confidence.toLowerCase()) ? fact.confidence.toLowerCase() : 'tentative');
    dom.setValue('fact-modal-related-vuln', fact.related_vulnerability_id || ''); dom.setValue('fact-modal-links', (fact.incoming_links ?? []).map(edge => `${edge.edge_type || edge.type}: ${edge.source_fact_key || edge.from}`).join('\n'));
    dom.setChecked('fact-modal-pinned', fact.pinned); updateFactFormHints();
  }
  function showAddFactModal() {
    if (!service.state.selectedId) return browser.alert(t('projects.selectProjectFirst'));
    if (!allowWrite()) return; ++factSequence; resetFact(); deps.openModal('fact-modal');
  }
  async function showEditFactModal(key: string) {
    const id = service.state.selectedId; if (!id) return browser.alert(t('projects.selectProjectFirst'));
    if (!allowWrite()) return;
    const seq = ++factSequence; resetFact(); deps.openModal('fact-modal', { focus: false });
    let fact: Fact;
    try { fact = await service.api.fact(id, key); }
    catch (error) { if (seq === factSequence) closeFactModal(); throw error; }
    deps.deferModalContent(() => { if (seq !== factSequence || id !== service.state.selectedId) return; fillFact(fact); dom.field('fact-modal-key')?.focus(); });
  }
  function closeFactModal() { ++factSequence; deps.closeModal('fact-modal'); resetFact(); }
  async function saveFactModal() {
    if (!allowWrite()) return;
    const payload: FactInput = { fact_key: dom.value('fact-modal-key').trim(), summary: dom.value('fact-modal-summary').trim(), category: dom.value('fact-modal-category').trim() || 'note', body: dom.value('fact-modal-body'), confidence: dom.value('fact-modal-confidence'), pinned: dom.checked('fact-modal-pinned'), related_vulnerability_id: dom.value('fact-modal-related-vuln').trim(), links_text: dom.value('fact-modal-links') };
    if (!payload.fact_key || !payload.summary) return browser.alert(t('projects.factKeySummaryRequired'));
    if (isSparseFactBody(payload.category, payload.fact_key, payload.body) && !browser.confirm(t('projects.confirmSaveSparseFact'))) return;
    await service.saveFact(factEditId, payload); closeFactModal(); await ctx.refreshFacts(); if (service.state.tab === 'graph') await ctx.refreshGraph();
  }
  function closeFactDetailModal() { ++detailSequence; detail = null; deps.closeModal('fact-detail-modal'); }
  async function viewProjectFactBody(key: string) {
    const seq = ++detailSequence, id = service.state.selectedId; detail = null;
    evidenceOffset = 0;
    dom.text('fact-detail-title', key); dom.text('fact-detail-meta', '…'); dom.text('fact-detail-body', ''); dom.hidden('fact-detail-sparse-warn', true); dom.hidden('fact-detail-link-vuln-btn', true); dom.hidden('fact-detail-create-vuln-btn', true);
    deps.openModal('fact-detail-modal', { focus: false });
    let fact: Fact;
    try { fact = await service.api.fact(id, key); }
    catch (error) { if (seq === detailSequence) closeFactDetailModal(); throw error; }
    let retained: Awaited<ReturnType<typeof service.api.evidence>> | null = null;
    try { retained = fact.verification_state ? await service.api.evidence(id, fact.id) : null; }
    catch (error) { if (seq === detailSequence) dom.text('fact-detail-meta', fmt('projects.evidenceLoadFailed', 'Evidence could not be loaded. Close and reopen this finding to retry.')); throw error; }
    deps.deferModalContent(() => {
      if (seq !== detailSequence || id !== service.state.selectedId) return; detail = fact;
      dom.text('fact-detail-title', `[${fact.fact_key}]`);
      const time = formatProjectTime(t, fact.updated_at, fact.created_at);
      const parts = [fmt('projects.factMetaCategory', `Category: ${fact.category}`, { value: fact.category }), fmt('projects.factMetaConfidence', `Confidence: ${fact.confidence}`, { value: fact.confidence }), fmt('projects.factMetaUpdated', `Updated: ${time}`, { time })];
      if (fact.verification_state) parts.push(`${fmt('projects.verification', 'Verification')}: ${fact.verification_state}`);
      if (fact.related_vulnerability_id) parts.push(fmt('projects.factMetaRelatedVuln', `Related vulnerability: ${fact.related_vulnerability_id}`, { value: fact.related_vulnerability_id }));
      if (fact.source_conversation_id) parts.push(fmt('projects.factMetaSourceConversation', `Source conversation: ${fact.source_conversation_id}`, { value: fact.source_conversation_id }));
      dom.html('fact-detail-meta', `${esc(parts.join(' · '))}${fact.source_conversation_id ? ` <button type="button" class="btn-secondary btn-small" data-action="projects.open-conversation" data-id="${esc(fact.source_conversation_id)}">Open source conversation</button>` : ''}${fact.related_vulnerability_id ? ` <button type="button" class="btn-secondary btn-small" data-action="projects.open-vulnerability" data-id="${esc(fact.related_vulnerability_id)}">Open vulnerability</button>` : ''}`); dom.text('fact-detail-body', fact.body || t('projects.emptyBody'));
      const sparse = isSparseFactBody(fact.category, fact.fact_key, fact.body); dom.hidden('fact-detail-sparse-warn', !sparse); dom.text('fact-detail-sparse-warn', sparse ? t('projects.factSparseWarn') : '');
      dom.hidden('fact-detail-link-vuln-btn', false); dom.hidden('fact-detail-create-vuln-btn', false);
      const nextStates: Record<string, VerificationState[]> = { observed: ['proposed'], proposed: ['verified', 'rejected'], verified: ['stale'], rejected: fact.verification_source === 'akg' ? [] : ['proposed'], stale: fact.verification_source === 'akg' ? [] : ['proposed'] };
      const controls = dom.document.createElement('div');
      controls.className = 'projects-table-actions';
      if (fact.revision && deps.hasPermission('project:write')) controls.innerHTML = (nextStates[fact.verification_state || ''] || []).map(state => dom.button('review-fact', fmt(`projects.review.${state}`, state), `data-state="${state}"`)).join('');
      dom.el('fact-detail-meta')?.append(controls);
      const section = dom.document.createElement('section'); section.id = 'fact-retained-evidence';
      if (retained) renderEvidence(section, retained);
      dom.el('fact-detail-meta')?.append(section);
    });
  }
  function renderEvidence(section: HTMLElement, retained: Awaited<ReturnType<typeof service.api.evidence>>) {
    section.innerHTML = `<h3>${esc(fmt('projects.retainedEvidence', 'Retained evidence and verification history'))}</h3>${retained.evidence.map(snapshot => `<details><summary>${esc(snapshot.akgObservationKind)}: ${esc(snapshot.akgObservationKey)} — ${esc(snapshot.provenanceChannel)}</summary><pre class="fact-detail-body">${esc(snapshot.snapshotJson)}</pre></details>`).join('')}<pre class="fact-detail-body">${esc(JSON.stringify(retained.history, null, 2))}</pre>${evidenceOffset ? dom.button('evidence-page', fmt('projects.evidenceNewer', 'Newer records'), `data-offset="${Math.max(0, evidenceOffset - 50)}"`) : ''}${retained.hasMore ? dom.button('evidence-page', fmt('projects.evidenceOlder', 'Older records'), `data-offset="${evidenceOffset + 50}"`) : ''}`;
  }
  async function evidencePage(offset: number) {
    const fact = detail, seq = detailSequence, id = service.state.selectedId;
    if (!fact) return;
    const retained = await service.api.evidence(id, fact.id, offset);
    if (seq !== detailSequence || id !== service.state.selectedId) return;
    evidenceOffset = offset;
    const section = dom.el('fact-retained-evidence'); if (section) renderEvidence(section, retained);
  }
  async function reviewFact(state: string) {
    const fact = detail, id = service.state.selectedId, seq = detailSequence;
    if (!fact?.revision || !allowWrite()) return;
    await service.api.reviewFact(id, fact.id, fact.revision, state as VerificationState);
    if (id !== service.state.selectedId || seq !== detailSequence) return;
    await viewProjectFactBody(fact.fact_key); await ctx.refreshFacts();
  }
  async function linkFactToExistingVulnerability() {
    const fact = detail; if (!fact || !allowWrite()) return;
    const items = await service.api.vulnerabilities(service.state.selectedId, { limit: 50 });
    if (!items.length) return browser.alert(t('projects.noVulnerabilitiesInProject'));
    const pick = browser.prompt(t('projects.promptLinkFactToVuln', { factKey: fact.fact_key, lines: items.map((item, i) => `${i + 1}. [${item.severity}] ${item.title} (${item.id})`).join('\n'), interpolation: { escapeValue: false } }));
    if (!pick) return; const item = items[Number.parseInt(pick, 10) - 1]; if (!item) return browser.alert(t('projects.invalidIndex'));
    await service.linkFact(fact, item.id); browser.alert(t('projects.linkSuccess')); closeFactDetailModal(); await ctx.refreshFacts();
  }
  async function createVulnerabilityFromCurrentFact() {
    const fact = detail; if (!fact || !deps.requirePermission('vulnerability:write')) return;
    const conversationId = fact.source_conversation_id?.trim() || deps.getConversationId().trim() || browser.prompt(t('projects.promptConversationIdForVulnCreate'))?.trim();
    if (!conversationId) return browser.alert(t('projects.cancelledNoConversationId'));
    const high = ['exploit', 'poc'].includes(fact.category.toLowerCase()) || /rce|sqli/.test(fact.fact_key.toLowerCase());
    const vulnerability = await service.api.createVulnerability({ conversation_id: conversationId, project_id: service.state.selectedId, title: (fact.summary || fact.fact_key).slice(0, 200), description: t('projects.generatedFromFact', { factKey: fact.fact_key, interpolation: { escapeValue: false } }), severity: high ? 'high' : 'medium', status: 'open', type: fact.category || 'finding', target: '', proof: fact.body || '', impact: '', recommendation: '' });
    await service.linkFact(fact, vulnerability.id); browser.alert(t('projects.createVulnerabilityAndLinkSuccess', { value: vulnerability.title || vulnerability.id, interpolation: { escapeValue: false } })); closeFactDetailModal(); await ctx.refreshFacts(); if (service.state.tab === 'vulns') await ctx.refreshVulnerabilities();
  }
  return { allowWrite, showNewProjectModal, showEditProjectModal, closeProjectModal, saveProjectModal, formatProjectScopeJson, insertProjectScopeExample, saveProjectSettings,
    reviewFact,
    evidencePage,
    showNewProjectModalFromChat() { ctx.closeChatPanel(); showNewProjectModal('chat'); }, showNewProjectModalFromChatSidebar: () => showNewProjectModal('sidebar'),
    setWebshellOrigin() { origin = 'webshell'; },
    showAddFactModal, showEditFactModal, closeFactModal, saveFactModal, updateFactFormHints, insertFactBodyTemplate, viewProjectFactBody, closeFactDetailModal, linkFactToExistingVulnerability, createVulnerabilityFromCurrentFact,
    editFactFromDetail() { const key = detail?.fact_key; closeFactDetailModal(); if (key) ctx.run(() => showEditFactModal(key)); },
  };
}
