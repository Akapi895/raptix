import { escapeNotificationHtml as e } from '../notifications';
import { UPDATE_POLL_INTERVAL_MS, updateApplyBlockers, updateBehindCount, type UpdateService } from './service';
import type { UpdateChange, UpdateDependencies, UpdateFailure, UpdateJob, UpdateModel, UpdateResult, UpdateStatus } from './types';

export function createUpdateView(document: Document, deps: UpdateDependencies) {
  const t = (key: string, options?: Record<string, unknown>) => deps.translate('update.' + key, { interpolation: { escapeValue: false }, ...options });
  const section = (title: string, body: string) => '<section class="update-section"><h3 class="update-section-title">' + e(title) + '</h3>' + body + '</section>';
  const fact = (label: string, value: unknown) => {
    const text = value == null || value === '' ? '-' : String(value);
    return '<div class="update-fact"><span>' + e(label) + '</span><code title="' + e(text) + '">' + e(text) + '</code></div>';
  };
  const mark = (ok: boolean, yes: string, no: string, reason = '') => '<span class="update-chip ' + (ok ? 'update-chip-ok' : 'update-chip-warn') + '"' + (reason ? ' title="' + e(reason) + '"' : '') + '>' + e(t(ok ? yes : no)) + '</span>';
  const button = (action: string, cls: string, label: string, disabled = false) => '<button class="' + cls + '"' +
    (disabled ? ' disabled data-state-disabled="true"' : '') + ' data-require-permission="update:apply" data-update-action="' + action + '">' + e(t(label)) + '</button>';
  const paths = (items: string[] | null | undefined, cls: string) => '<ul class="' + cls + '">' + (items || []).map(path => '<li><code title="' + e(path) + '">' + e(path) + '</code></li>').join('') + '</ul>';
  const hint = (key: string) => '<div class="update-hint">' + e(t(key)) + '</div>';
  function restartChoice(model: Readonly<UpdateModel>): string {
    if (!model.console?.canRestart) return hint('restartNotWired');
    return '<label class="update-restart-choice"><input type="checkbox" id="update-restart-choice"' + (model.restartChoice ? ' checked' : '') +
      ' data-update-change="restart"><span>' + e(t('restartChoiceLabel')) + '</span></label><div class="update-hint update-restart-preview">' + e(t(model.restartChoice ? 'confirmRestartYes' : 'confirmRestartNo')) + '</div>';
  }
  function adoptBody(model: Readonly<UpdateModel>): string {
    const plan = model.adoptPlan;
    if (!plan) return hint('adoptHint') + '<div class="update-actions">' + button('preview-adopt', 'btn-primary update-adopt-preview-btn', 'adoptPreviewBtn', model.busy) + '</div>';
    return hint('adoptHint') + '<div class="update-facts">' + fact(t('adoptIncoming'), plan.incoming) +
      fact(t('adoptOverwrittenTotal'), plan.overwrittenTotal) + fact(t('adoptProtectedTotal'), plan.protectedTotal) + fact(t('sourceBranch'), plan.branch) + fact(t('adoptCommit'), plan.commit) + '</div>' +
      (plan.overwritten?.length ? '<h4 class="update-sub-title">' + e(t('adoptOverwrittenTitle')) + '</h4>' + paths(plan.overwritten, 'update-commit-list') : '') +
      (plan.protected?.length ? '<h4 class="update-sub-title">' + e(t('adoptProtectedTitle')) + '</h4>' + paths(plan.protected, 'update-commit-list') : '') +
      hint('adoptBackupNote') + restartChoice(model) + '<div class="update-actions">' + button('confirm-adopt', 'btn-primary update-adopt-confirm-btn', 'adoptConfirmBtn', model.busy) + '</div>';
  }
  function sourceBody(status: UpdateStatus, model: Readonly<UpdateModel>): string {
    const source = model.console?.source || {}, defaultRepo = source.defaultRepo || '';
    return '<div class="update-hint">' + e(source.configured ? t('sourceFromConfig') : t('sourceIsDefault', { repo: defaultRepo })) + '</div>' +
      (status.repo ? '<div class="update-facts">' + fact(t('sourceUrl'), status.repo) + '</div>' : '') +
      '<div class="update-source-form"><label>' + e(t('sourceUrlLabel')) + '<input type="text" class="update-source-input update-source-url" value="' + e(model.sourceDraft ?? source.repo ?? '') +
      '" placeholder="' + e(defaultRepo) + '" data-update-input="source"></label><div class="update-hint">' + e(t('sourceRepoHint', { repo: defaultRepo })) + '</div><div class="update-actions">' +
      button('save-source', 'btn-secondary update-source-save-btn', 'sourceSaveBtn', model.busy) + '</div></div>' +
      (model.sourceError ? '<div class="update-error">' + e(model.sourceError) + '</div>' : '') + (!status.installed ? adoptBody(model) : '');
  }
  function installBody(status: UpdateStatus, model: Readonly<UpdateModel>): string {
    return '<div class="update-facts">' + fact(t('root'), status.root) + fact(t('branch'), status.branch) + fact(t('commit'), status.commit) + fact(t('committedAt'), status.committedAt) + fact(t('subject'), status.subject) +
      '</div><div class="update-marks">' + mark(!!status.installed, 'gitTree', 'notGitTree') +
      mark(!!status.canBuild, 'toolchainFound', 'toolchainMissing', status.goToolchain || (status.canBuild ? '' : t('toolchainMissingHint'))) +
      mark(!!status.hasBinary, 'binaryPresent', 'binaryMissing') + mark(!!status.hasRollback, 'rollbackPresent', 'rollbackMissing') +
      (model.console?.needsRestart ? '<span class="update-chip update-chip-warn">' + e(t('restartNeeded')) + '</span>' : '') + '</div>';
  }
  function remoteBody(status: UpdateStatus, model: Readonly<UpdateModel>): string {
    const failure = model.check.error || status.checkError;
    const parts = [failure ? '<div class="update-error update-check-failed">' + e(t('checkFailed', { reason: failure })) + '</div>' :
      !model.check.done ? hint('notChecked') : status.updateAvailable ? '<div class="update-behind">' + e(t('behindCount', { n: updateBehindCount(status) })) + '</div>' :
        '<div class="update-ok">' + e(t('upToDate', { commit: status.commit || '-' })) + '</div>'];
    if ((status.ahead || 0) > 0) parts.push('<div class="update-warn">' + e(t('aheadCount', { n: status.ahead })) + '</div>');
    if (status.targetBranch || status.remoteCommit) parts.push('<div class="update-facts">' + fact(t('sourceBranch'), status.targetBranch) + fact(t('remoteHead'), status.remoteCommit) + fact(t('remoteSubject'), status.remoteSubject) + '</div>');
    const incoming = status.incoming || [];
    if (incoming.length) {
      const total = status.incomingTotal || incoming.length;
      parts.push('<h4 class="update-sub-title">' + e(t('incomingTitle')) + '</h4>');
      if (total > incoming.length) parts.push('<div class="update-hint">' + e(t('incomingTruncated', { total, shown: incoming.length })) + '</div>');
      parts.push('<ul class="update-commit-list">' + incoming.map(commit => '<li><code title="' + e(commit.commit || '-') + '">' + e(commit.commit || '-') + '</code> <span class="update-commit-subject">' + e(commit.subject) + '</span></li>').join('') + '</ul>');
    }
    return parts.join('');
  }
  function changesTable(changes: UpdateChange[]): string {
    return '<table class="update-table"><thead><tr><th>' + e(t('colPath')) + '</th><th>' + e(t('colChangeStatus')) + '</th><th>' + e(t('colOwner')) + '</th></tr></thead><tbody>' +
      changes.map(change => '<tr class="' + (change.protected ? 'update-row-kept' : 'update-row-blocking') + '"><td><code title="' + e(change.path) + '">' + e(change.path || '-') + '</code></td><td>' + e(change.status || '-') + '</td><td>' + e(t(change.protected ? 'keptFile' : 'productSource')) + '</td></tr>').join('') + '</tbody></table>';
  }
  function applyBody(status: UpdateStatus, job: UpdateJob | null, model: Readonly<UpdateModel>): string {
    const blockers = updateApplyBlockers(status, job, t), parts: string[] = [];
    if (job?.state === 'running') parts.push('<div class="update-warn">' + e(t('jobRunningHint')) + '</div>');
    if (!status.canBuild && status.installed) parts.push('<div class="update-warn">' + e(t('noToolchainWarn')) + '</div>');
    if (status.rollbackPending) parts.push('<div class="update-warn">' + e(t('rollbackPendingHint')) + '</div>');
    if (status.buildPending && status.installed) parts.push('<div class="update-warn">' + e(t('buildPendingHint')) + '</div>');
    parts.push('<div class="update-actions">' + button('apply', 'btn-primary update-apply-btn', 'applyBtn', blockers.length > 0) +
      button('check', 'btn-secondary update-check-btn', model.checking ? 'checking' : 'checkBtn', model.checking) + '</div>', restartChoice(model));
    if (blockers.length) parts.push('<ul class="update-blocker-list">' + blockers.map(text => '<li class="update-error">' + e(text) + '</li>').join('') + '</ul>');
    const seen = new Set<string>();
    const changes = [...status.localChanges || [], ...status.blockingChanges || []].filter(change => {
      if (!change.path || seen.has(change.path)) return false; seen.add(change.path); return true;
    });
    parts.push(changes.length ? '<h4 class="update-sub-title">' + e(t('localChangesTitle')) + '</h4>' + hint('localChangesHint') + changesTable(changes) : hint('noLocalChanges'));
    return parts.join('');
  }
  function resultBody(result: UpdateResult): string {
    return '<div class="update-result"><h4 class="update-sub-title">' + e(t('resultTitle')) + '</h4><div class="update-facts">' +
      fact(t('resultFrom'), result.fromCommit) + fact(t('resultTo'), result.toCommit) + fact(t('resultCommits'), result.commits) + fact(t('resultFiles'), result.filesTouched) + fact(t('resultDuration'), result.duration) + fact(t('resultBackup'), result.backupDir) +
      '</div><div class="update-marks">' + mark(!!result.binaryBuilt, 'binarySwapped', 'binaryNotSwapped', result.binaryPath) + mark(!!result.needsRestart, 'restartNeeded', 'restartNotNeeded') + '</div>' +
      (result.adopted ? hint('adoptedNoPreviousCommit') : '') + (result.overwritten?.length ? '<h4 class="update-sub-title">' + e(t('resultOverwrittenTitle')) + '</h4>' + paths(result.overwritten, 'update-kept-list') : '') +
      '<h4 class="update-sub-title">' + e(t('keptTitle')) + '</h4>' + (result.keptContent?.length ? paths(result.keptContent, 'update-kept-list') : hint('nothingKept')) + '</div>';
  }
  function failureBody(failure: UpdateFailure): string {
    return '<div class="update-error update-failure"><div class="update-failure-title">' + e(t('failureTitle')) + (failure.reason ? ` (${e(failure.reason)})` : '') +
      '</div><div class="update-failure-message">' + e(failure.message || t('failureNoMessage')) + '</div>' + (failure.items?.length ? paths(failure.items, 'update-item-list') : '') + '</div>';
  }
  function jobBody(job: UpdateJob | null): string {
    if (!job) return '<div class="empty-state">' + e(t('noJob')) + '</div>';
    const cls = job.state === 'running' ? 'update-chip-running' : job.state === 'succeeded' ? 'update-chip-ok' : job.state === 'failed' ? 'update-chip-danger' : 'update-chip';
    const label = job.state === 'running' ? 'stateRunning' : job.state === 'succeeded' ? 'stateSucceeded' : job.state === 'failed' ? 'stateFailed' : 'stateUnknown';
    return '<div class="update-job-head"><span class="' + cls + '">' + e(t(label)) + '</span><code title="' + e(job.id || '-') + '">' + e(job.id || '-') + '</code>' +
      (job.started ? '<span class="update-job-time">' + e(job.started) + '</span>' : '') + (job.restartRequested ? '<span class="update-chip">' + e(t('restartRequested')) + '</span>' : '') + '</div>' +
      (job.steps?.length ? '<ol class="update-step-list">' + job.steps.map(step => '<li class="update-step"><code class="update-step-phase">' + e(step.phase || '-') + '</code><span class="update-step-message">' + e(step.message) + '</span><span class="update-step-at">' + e(step.at) + '</span></li>').join('') + '</ol>' : '<div class="empty-state">' + e(t('noSteps')) + '</div>') +
      (job.state === 'running' ? '<div class="update-hint">' + e(t('pollingHint', { sec: UPDATE_POLL_INTERVAL_MS / 1000 })) + '</div>' : '') + (job.result ? resultBody(job.result) : '') + (job.failure ? failureBody(job.failure) : '');
  }
  function rollbackBody(status: UpdateStatus, job: UpdateJob | null): string {
    return !status.hasRollback ? '<div class="empty-state">' + e(t('noRollback')) + '</div>' :
      '<p class="update-hint">' + e(t('rollbackTarget', { commit: status.rollbackTo || '-' })) + '</p><div class="update-actions">' + button('rollback', 'btn-secondary update-rollback-btn', 'rollbackBtn', job?.state === 'running') + '</div>';
  }
  function restartBanner(model: Readonly<UpdateModel>): string {
    const commit = model.console?.status.commit || '', raw = model.console?.binaryBuiltAt || '', date = new Date(raw);
    const builtAt = !raw ? '-' : Number.isNaN(date.getTime()) ? raw : date.toLocaleString();
    return '<div class="update-restart-banner"><div class="update-restart-banner-text">' + e(t(commit ? 'restartBanner' : 'restartBannerNoCommit', { commit: commit || '-', builtAt })) + '</div>' + button('restart', 'btn-primary update-restart-btn', 'restartNowBtn') + '</div>';
  }
  function render(model: Readonly<UpdateModel>): void {
    const root = document.getElementById('update-console'); if (!root) return;
    // Preserve cursor/selection when progress polling redraws the source form.
    const input = root.querySelector<HTMLInputElement>('[data-update-input="source"]');
    const focused = input === document.activeElement;
    const selection = focused && input ? [input.selectionStart, input.selectionEnd] as const : null;
    if (model.watchdog) {
      root.innerHTML = '<div class="update-overlay"><div class="update-overlay-spinner" aria-hidden="true"></div><div class="update-overlay-title">' + e(t('restartOverlayTitle')) + '</div><div class="update-overlay-body">' + e(t('restartOverlayBody')) + '</div>' +
        (model.watchdogSlow ? '<div class="update-overlay-slow">' + e(t(model.watchdogSlow === 'running' ? 'restartOverlaySlowRunning' : 'restartOverlaySlowDown')) + '</div>' : '') +
        '<div class="update-overlay-actions"><button class="btn-secondary" type="button" data-update-action="refresh">' + e(t('restartOverlayRefresh')) + '</button></div></div>';
      return;
    }
    if (model.loading || model.loadError) { root.innerHTML = '<div class="empty-state">' + e(model.loading ? t('loading') : model.loadError) + '</div>'; return; }
    if (!model.console) return;
    const { status, job } = model.console;
    root.innerHTML = (model.actionError ? '<div class="update-error">' + e(model.actionError) + '</div>' : '') + (model.console.needsRestart ? restartBanner(model) : '') +
      section(t('installTitle'), installBody(status, model)) + section(t('sourceTitle'), sourceBody(status, model)) + section(t('remoteTitle'), remoteBody(status, model)) +
      section(t('applyTitle'), applyBody(status, job, model)) + section(t('jobTitle'), jobBody(job)) + section(t('rollbackTitle'), rollbackBody(status, job));
    deps.applyPermissions(root);
    if (selection) { const next = root.querySelector<HTMLInputElement>('[data-update-input="source"]'); next?.focus(); next?.setSelectionRange(...selection); }
  }
  function bind(service: UpdateService): () => void {
    const root = document.getElementById('update-console'); if (!root) return () => {};
    const actions: Record<string, () => void | Promise<void>> = {
      load: service.load, check: service.check, apply: service.apply, restart: service.restartNow, rollback: service.rollback,
      'save-source': service.saveSource, 'preview-adopt': service.previewAdopt, 'confirm-adopt': service.confirmAdopt, refresh: deps.reload,
    };
    const click = (event: Event) => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest<HTMLElement>('[data-update-action]');
      if (!button || (!root.contains(button) && !document.getElementById('settings-section-update')?.contains(button)) || button.matches(':disabled, [aria-disabled="true"]')) return;
      event.preventDefault();
      // The checkbox is the source of truth, including programmatic form edits.
      const box = root.querySelector<HTMLInputElement>('#update-restart-choice');
      if (box && box.checked !== service.getModel().restartChoice) service.restartChoiceChanged(box.checked);
      void actions[button.dataset.updateAction || '']?.();
    };
    const input = (event: Event) => { if (event.target instanceof HTMLInputElement && event.target.dataset.updateInput === 'source') service.sourceChanged(event.target.value); };
    const change = (event: Event) => { if (event.target instanceof HTMLInputElement && event.target.dataset.updateChange === 'restart') service.restartChoiceChanged(event.target.checked); };
    document.addEventListener('click', click); root.addEventListener('input', input); root.addEventListener('change', change);
    return () => { document.removeEventListener('click', click); root.removeEventListener('input', input); root.removeEventListener('change', change); };
  }
  return { render, bind };
}
