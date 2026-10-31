// Keeping a live progress timeline short: when it grows past its limit, the oldest removable items go, and a marker at the top
// says how many were taken away and which main rounds they were. Items that wait for a human decision are never removed.

import type { TimelineTranslate } from './tool-result';

export const LIVE_TIMELINE_MAX_ITEMS = 150;
export const LIVE_TIMELINE_PRUNE_CHUNK = 50;

/** Whether a timeline is the live timeline of a progress (its id names the progress). */
export function isLiveProgressTimeline(timeline: HTMLElement | null | undefined): boolean {
  return !!(timeline && timeline.id && /^progress-\d+-\d+-timeline$/.test(timeline.id));
}

/** The text of the marker: the count, and the main rounds it covers when it knows them. */
export function formatLiveTimelinePrunedMarker(marker: HTMLElement, t: TimelineTranslate): string {
  const count = parseInt(marker.dataset.prunedCount || '0', 10) || 0;
  const minIteration = parseInt(marker.dataset.prunedMainIterationMin || '0', 10) || 0;
  const maxIteration = parseInt(marker.dataset.prunedMainIterationMax || '0', 10) || 0;
  const baseText = t('chat.liveTimelinePruned', { count });
  if (minIteration <= 0 || maxIteration < minIteration) return baseText;
  if (minIteration === maxIteration) {
    return baseText + ' · ' + t('chat.liveTimelinePrunedSingleRound', { n: minIteration });
  }
  return baseText + ' · ' + t('chat.liveTimelinePrunedRoundRange', { from: minIteration, to: maxIteration });
}

/** Removes the oldest items of a live timeline that is over its limit, and records them on the marker. */
export function pruneLiveTimelineIfNeeded(doc: Document, timeline: HTMLElement | null | undefined, t: TimelineTranslate): void {
  if (!timeline || !isLiveProgressTimeline(timeline)) return;
  const items = Array.from(timeline.children).filter((el): el is HTMLElement => !!el && el.classList && el.classList.contains('timeline-item'));
  if (items.length <= LIVE_TIMELINE_MAX_ITEMS) return;

  let marker = timeline.querySelector<HTMLElement>('.timeline-live-pruned-marker');
  let pruned = marker ? (parseInt(marker.dataset.prunedCount || '0', 10) || 0) : 0;
  const removable = items.filter(el => !el.dataset.hitlInterruptId &&
    !el.dataset.workflowRunId &&
    !el.classList.contains('timeline-item-workflow_hitl_waiting') &&
    !el.classList.contains('timeline-item-hitl_interrupt'));
  const overflow = items.length - LIVE_TIMELINE_MAX_ITEMS;
  const removeCount = Math.min(removable.length, Math.max(overflow, LIVE_TIMELINE_PRUNE_CHUNK));
  if (removeCount <= 0) return;

  if (!marker) {
    marker = doc.createElement('div');
    marker.className = 'timeline-live-pruned-marker';
    marker.setAttribute('role', 'status');
    marker.setAttribute('aria-live', 'polite');
    timeline.insertBefore(marker, timeline.firstChild);
  }
  let prunedMainIterationMin = parseInt(marker.dataset.prunedMainIterationMin || '0', 10) || 0;
  let prunedMainIterationMax = parseInt(marker.dataset.prunedMainIterationMax || '0', 10) || 0;
  for (let i = 0; i < removeCount; i++) {
    const removed = removable[i];
    if (!removed) continue;
    if (removed.dataset && removed.dataset.timelineType === 'iteration' && removed.dataset.einoScope !== 'sub') {
      const iteration = parseInt(removed.dataset.iterationN || '0', 10) || 0;
      if (iteration > 0) {
        if (prunedMainIterationMin === 0 || iteration < prunedMainIterationMin) prunedMainIterationMin = iteration;
        if (iteration > prunedMainIterationMax) prunedMainIterationMax = iteration;
      }
    }
    removed.remove();
  }
  pruned += removeCount;
  marker.dataset.prunedCount = String(pruned);
  marker.dataset.prunedMainIterationMin = String(prunedMainIterationMin);
  marker.dataset.prunedMainIterationMax = String(prunedMainIterationMax);
  marker.textContent = formatLiveTimelinePrunedMarker(marker, t);
  // The marker stays above the kept details, so the history that was removed is visible even when the newest part is in view.
  if (timeline.firstChild !== marker) timeline.insertBefore(marker, timeline.firstChild);
}
