import type { UpdateClient } from './client';
import type { UpdateDependencies, UpdateJob, UpdateModel, UpdateResult, UpdateStatus } from './types';

export const UPDATE_POLL_INTERVAL_MS = 1500;
const failureKeys = { check: 'checkFailed', apply: 'applyFailed', rollback: 'rollbackFailed', load: 'loadFailed', source: 'sourceSaveFailed', adopt: 'adoptFailed', restart: 'restartFailed' } as const;
export const updateBehindCount = (status: UpdateStatus): number => status.incomingTotal || status.behind || status.incoming?.length || 0;
export function updateApplyBlockers(status: UpdateStatus, job: UpdateJob | null, t: (key: string, options?: Record<string, unknown>) => string): string[] {
  const blockers: string[] = [];
  if (status.rollbackPending) blockers.push(t('rollbackPendingHint'));
  if (!status.installed) blockers.push(t('blockedNotGitTree'));
  if (job?.state === 'running') blockers.push(t('blockedJobRunning'));
  if (status.blockingChanges?.length) blockers.push(t('blockedLocalEdits', { n: status.blockingChanges.length }));
  if (status.diverged) blockers.push(t('blockedDiverged', { ahead: status.ahead || 0, behind: status.behind || 0 }));
  if (!status.updateAvailable && !status.buildPending) blockers.push(t('blockedNoUpdate'));
  return blockers;
}
export function createUpdateService(client: UpdateClient, deps: UpdateDependencies, render: (model: Readonly<UpdateModel>) => void) {
  const model: UpdateModel = { console: null, check: { done: false, error: '' }, busy: false, checking: false,
    restartChoice: true, restartPending: false, watchdog: false, watchdogSlow: null, sourceDraft: null,
    sourceError: '', actionError: '', adoptPlan: null, loading: false, loadError: '' };
  let disposed = false, choiceSet = false, autoChecked = false, probing = false, polling = false;
  let pollTimer: number | undefined, watchdogTimer: number | undefined, autoTimer: number | undefined;
  let deadline = 0, pollEpoch = 0, watchdogEpoch = 0, loadEpoch = 0;
  const t = (key: string, options?: Record<string, unknown>) => deps.translate('update.' + key, { interpolation: { escapeValue: false }, ...options });
  const emit = () => { if (!disposed) render(model); };
  const status = () => model.console?.status ?? {};
  const running = () => model.console?.job?.state === 'running';
  const resetCheck = () => { model.check = { done: false, error: '' }; };
  const reason = (error: unknown) => error instanceof Error ? error.message : String(error);
  const notify = (text: string, type: 'success' | 'error' | 'info') => { if (!disposed) { try { deps.notify(text, type); } catch { /* Toast failures cannot change HTTP outcomes. */ } } };
  async function run(method: 'GET' | 'POST', path = '', body?: unknown) {
    const result = await client.run(method, path, body);
    if (disposed) throw new Error('Update console disposed');
    return result;
  }
  async function fetchStatus(): Promise<void> {
    const result = await run('GET');
    if (!result.ok) throw new Error(result.error);
    const data = result.data;
    model.console = { status: typeof data.status === 'object' && data.status ? data.status : {}, job: data.job || null,
      canRestart: !!data.canRestart, supervised: !!data.supervised, needsRestart: !!data.needsRestart,
      binaryBuiltAt: data.binaryBuiltAt || '', source: data.source || { repo: '', configured: false, defaultRepo: '' } };
    if (!choiceSet) model.restartChoice = model.console.supervised;
  }
  async function busy(action: () => Promise<void>, label: keyof typeof failureKeys): Promise<void> {
    if (disposed || model.busy) return;
    model.busy = true; model.actionError = ''; emit();
    try { await action(); }
    catch (error) {
      if (!disposed) { model.actionError = t(failureKeys[label], { reason: reason(error) }); notify(model.actionError, 'error'); }
    } finally { model.busy = false; emit(); }
  }
  function stopPolling(): void {
    ++pollEpoch;
    if (pollTimer !== undefined) deps.runtime.cancelEvery(pollTimer);
    pollTimer = undefined;
    if (autoTimer !== undefined) deps.runtime.cancel(autoTimer);
    autoTimer = undefined;
  }
  function startPolling(): void {
    stopPolling(); if (disposed) return;
    pollTimer = deps.runtime.every(() => { void poll(); }, UPDATE_POLL_INTERVAL_MS);
  }
  function stopWatchdog(): void {
    ++watchdogEpoch;
    if (watchdogTimer !== undefined) deps.runtime.cancelEvery(watchdogTimer);
    watchdogTimer = undefined;
  }
  async function probe(): Promise<void> {
    if (disposed || !deps.isActive()) { stopWatchdog(); return; }
    if (probing) return;
    probing = true; const epoch = watchdogEpoch;
    let code = 0;
    try { code = (await deps.probe()).status; } catch { /* Restart transport gap. */ }
    finally { probing = false; }
    if (disposed || epoch !== watchdogEpoch || !deps.isActive()) return;
    if (code === 401) { stopWatchdog(); deps.restarted(); return; }
    if (model.watchdogSlow === null && deps.runtime.now() > deadline) { model.watchdogSlow = code === 200 ? 'running' : 'down'; emit(); }
  }
  function startWatchdog(): void {
    if (disposed || watchdogTimer !== undefined) return;
    model.restartPending = true; model.watchdog = true; model.watchdogSlow = null;
    deadline = deps.runtime.now() + 90_000; emit();
    watchdogTimer = deps.runtime.every(() => { void probe(); }, 2000);
  }
  function doneToast(result?: UpdateResult | null): string {
    if (result?.binaryBuilt && result.fromCommit && result.fromCommit === result.toCommit) return t('buildDoneToast');
    return t('jobDoneToast') + (result?.toCommit ? ' ' + result.fromCommit + ' → ' + result.toCommit : '');
  }
  async function reportFinished(job: UpdateJob): Promise<void> {
    if (job.state === 'succeeded') {
      notify(doneToast(job.result), 'success'); if (job.result?.needsRestart) notify(t('needsRestartToast'), 'info');
    } else notify(t('jobFailedToast') + ': ' + (job.failure?.message || t('failureNoMessage')), 'error');
    resetCheck();
    try { await fetchStatus(); emit(); } catch (error) { notify(t('loadFailed', { reason: reason(error) }), 'error'); }
  }
  async function poll(): Promise<void> {
    if (disposed || !deps.isActive()) { stopPolling(); return; }
    if (polling) return;
    polling = true; const epoch = pollEpoch;
    try {
      let result;
      try { result = await run('GET', '/job'); }
      catch (error) { result = { ok: false, error: reason(error), data: {} }; }
      if (disposed || epoch !== pollEpoch || !deps.isActive()) return;
      if (!result.ok) {
        stopPolling();
        if (model.restartPending) startWatchdog(); else notify(t('jobPollFailed', { reason: result.error }), 'error');
        return;
      }
      const job = result.data.job || null;
      if (model.console) model.console.job = job;
      emit();
      if (job && job.state !== 'running') {
        stopPolling();
        if (job.state === 'succeeded' && job.restartRequested) { notify(doneToast(job.result), 'success'); startWatchdog(); return; }
        model.restartPending = false; await reportFinished(job);
      }
    } finally { polling = false; }
  }
  async function load(): Promise<void> {
    if (disposed) return;
    stopPolling(); const epoch = ++loadEpoch;
    if (model.restartPending) { startWatchdog(); return; }
    resetCheck(); choiceSet = false; model.restartChoice = true; model.actionError = ''; model.loadError = ''; model.loading = true; emit();
    try { await fetchStatus(); }
    catch (error) { if (!disposed && epoch === loadEpoch) { model.loadError = t('loadFailed', { reason: reason(error) }); model.loading = false; emit(); } return; }
    if (disposed || epoch !== loadEpoch) return;
    model.loading = false; emit();
    if (running()) startPolling();
    if (!autoChecked && status().installed && !running()) {
      autoChecked = true;
      autoTimer = deps.runtime.after(() => { autoTimer = undefined; if (!disposed && deps.isActive()) void check(); }, 1200);
    }
  }
  async function check(): Promise<void> {
    await busy(async () => {
      model.checking = true; emit();
      let result;
      try { result = await run('POST', '/check'); }
      catch (error) { model.check = { done: false, error: reason(error) }; throw error; }
      finally { model.checking = false; }
      if (!result.ok) { model.check = { done: false, error: result.error }; notify(t('checkFailed', { reason: result.error }), 'error'); return; }
      const value = typeof result.data.status === 'object' && result.data.status ? result.data.status : {};
      if (model.console) model.console.status = value;
      model.check = { done: true, error: value.checkError || '' }; emit();
      if (model.check.error) notify(t('checkFailed', { reason: model.check.error }), 'error');
      else if (value.updateAvailable) notify(t('behindCount', { n: updateBehindCount(value) }), 'info');
      else notify(t('upToDate', { commit: value.commit || '-' }), 'success');
    }, 'check');
  }
  async function apply(): Promise<void> {
    if (disposed || model.busy) return;
    const value = status(), blockers = updateApplyBlockers(value, model.console?.job || null, t);
    if (blockers.length) { notify(blockers[0] || '', 'error'); return; }
    const restart = model.restartChoice;
    const base = !value.updateAvailable && value.buildPending ? t('confirmBuildPending', { commit: value.commit || '-' }) :
      t('confirmApply', { repo: value.repo || '-', target: value.remoteCommit || '-', commit: value.commit || '-', n: updateBehindCount(value) });
    if (!deps.confirm(base + ' ' + t(restart ? 'confirmRestartYes' : 'confirmRestartNo'))) return;
    await busy(async () => {
      const result = await run('POST', '/apply', { restart });
      if (result.status === 409 && result.data.job) { if (model.console) model.console.job = result.data.job; emit(); startPolling(); }
      if (!result.ok) throw new Error(result.error);
      resetCheck(); if (restart) model.restartPending = true;
      startPolling(); notify(t('applyAccepted', { id: result.data.job_id || '-' }), 'success'); await poll();
    }, 'apply');
  }
  async function restartNow(): Promise<void> {
    if (disposed || model.busy || !deps.confirm(t('restartNowConfirm'))) return;
    await busy(async () => {
      const result = await run('POST', '/restart'); if (!result.ok) throw new Error(result.error);
      stopPolling(); notify(t('restartRequestedToast'), 'info'); startWatchdog();
    }, 'restart');
  }
  async function rollback(): Promise<void> {
    if (disposed || model.busy || !status().hasRollback) return;
    if (running()) { notify(t('blockedJobRunning'), 'error'); return; }
    if (!deps.confirm(t('confirmRollback', { commit: status().rollbackTo || '-' }))) return;
    await busy(async () => {
      const result = await run('POST', '/rollback');
      if (!result.ok) throw new Error(result.error + (result.data.items?.length ? ' · ' + t('rollbackItems') + ': ' + result.data.items.join(', ') : ''));
      const to = result.data.result?.toCommit || status().rollbackTo || '-';
      resetCheck(); model.restartChoice = false; await fetchStatus(); emit(); notify(t('rollbackDone', { commit: to }), 'success');
    }, 'rollback');
  }
  const sourceRepo = () => model.sourceDraft ?? model.console?.source.repo ?? '';
  async function saveSource(): Promise<void> {
    if (disposed || model.busy) return;
    const repo = sourceRepo().trim(); model.sourceError = '';
    await busy(async () => {
      const result = await run('POST', '/source', { repo });
      if (!result.ok) { model.sourceError = t('sourceSaveFailed', { reason: result.error }); notify(model.sourceError, 'error'); return; }
      model.sourceDraft = null; if (model.console && result.data.source) model.console.source = result.data.source;
      resetCheck(); await fetchStatus(); emit(); notify(t('sourceSaveOk'), 'success');
    }, 'source');
  }
  async function previewAdopt(): Promise<void> {
    if (disposed || model.busy) return;
    model.sourceError = '';
    await busy(async () => {
      const result = await run('POST', '/adopt', { confirm: false });
      if (!result.ok) { model.sourceError = t('adoptFailed', { reason: result.error }); notify(model.sourceError, 'error'); return; }
      model.adoptPlan = result.data.plan || null; emit();
    }, 'adopt');
  }
  async function confirmAdopt(): Promise<void> {
    if (disposed || model.busy || !model.adoptPlan) return;
    const plan = model.adoptPlan, restart = model.restartChoice;
    if (!deps.confirm(t('adoptConfirmText', { incoming: plan.incoming, overwritten: plan.overwrittenTotal, protectedFiles: plan.protectedTotal }))) return;
    await busy(async () => {
      const result = await run('POST', '/adopt', { confirm: true, restart }); if (!result.ok) throw new Error(result.error);
      model.adoptPlan = null; resetCheck(); if (restart) model.restartPending = true;
      startPolling(); notify(t('adoptAccepted', { id: result.data.job_id || '-' }), 'success'); await poll();
    }, 'adopt');
  }
  return {
    load, check, apply, restartNow, rollback, saveSource, previewAdopt, confirmAdopt, poll,
    stopPolling, stopWatchdog, render: emit, getModel: () => model, sourceRepo, translate: t,
    sourceChanged(value: string) { if (!disposed) model.sourceDraft = value; },
    restartChoiceChanged(value: boolean) { if (!disposed) { model.restartChoice = value; choiceSet = true; emit(); } },
    dispose() { disposed = true; ++loadEpoch; stopPolling(); stopWatchdog(); },
  };
}
export type UpdateService = ReturnType<typeof createUpdateService>;
