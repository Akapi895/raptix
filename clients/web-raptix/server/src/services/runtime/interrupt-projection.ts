/**
 * W11 pending graph-interrupt projection: find a restoreable
 * `ask_user_question` interrupt in runtime thread state values and validate a
 * proposed resume answer against its declared options/semantics. Bounded
 * search — never executes payload content, never fabricates a question.
 */
import type { PendingInterruptView } from '@raptix/web-contracts';

const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function questionFrom(value: unknown): PendingInterruptView | null {
  if (!record(value) || value.type !== 'ask_user_question') return null;
  const questionId = typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 256 ? value.id : null;
  if (!questionId || typeof value.question !== 'string' || !value.question || value.question.length > 4000) return null;
  const options: { label: string; description: string }[] = [];
  if (Array.isArray(value.options)) {
    for (const option of value.options.slice(0, 10)) {
      if (!record(option) || typeof option.label !== 'string' || !option.label || option.label.length > 500 || typeof option.description !== 'string') return null;
      options.push({ label: option.label, description: option.description });
    }
  }
  const header = typeof value.header === 'string' ? value.header.slice(0, 200) : '';
  return { questionId, question: value.question, header, options, multiSelect: value.multi_select === true, allowOther: value.allow_other === true, source: 'runtime' };
}

/** Depth-first bounded scan of `values.__interrupt__` (and nested task entries). */
export function findPendingQuestion(values: Record<string, unknown>): PendingInterruptView | null {
  const queue: unknown[] = [values.__interrupt__];
  for (let seen = 0; queue.length && seen < 200; ) {
    const current = queue.shift();
    seen++;
    if (Array.isArray(current)) {
      if (queue.length + current.length > 400) return null;
      queue.push(...current.slice(0, 100));
    } else if (record(current)) {
      const direct = questionFrom(current.value ?? current);
      if (direct) return direct;
      if (current.value !== undefined) queue.push(current.value);
      if (current.__interrupt__ !== undefined) queue.push(current.__interrupt__);
    }
  }
  return null;
}

/** Validates the operator answer against the question contract; throws 400 on mismatch. */
export function assertResumeValue(value: string | string[], pending: PendingInterruptView): void {
  const labels = new Set(pending.options.map(option => option.label));
  const ok = (answer: string): boolean => (labels.has(answer) ? true : pending.allowOther && answer.trim().length > 0 && answer.length <= 500);
  if (pending.multiSelect) {
    if (!Array.isArray(value) || value.length === 0 || !value.every(ok)) throw new Error('invalid');
  } else if (typeof value !== 'string' || !ok(value)) {
    throw new Error('invalid');
  }
}
