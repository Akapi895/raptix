/**
 * W11 pending graph-interrupt projection: find a restoreable
 * `ask_user_question` interrupt in runtime thread state values and validate a
 * proposed resume answer against its declared options/semantics. Bounded
 * search — never executes payload content, never fabricates a question.
 */
import type { PendingInterruptView } from '@raptix/web-contracts';

const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function questionFrom(value: unknown, interruptId?: unknown): PendingInterruptView | null {
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
  const langgraphInterruptId = typeof interruptId === 'string' && interruptId.length > 0 && interruptId.length <= 256 ? interruptId : undefined;
  return { questionId, question: value.question, header, options, multiSelect: value.multi_select === true, allowOther: value.allow_other === true, source: 'runtime', ...(langgraphInterruptId ? { interruptId: langgraphInterruptId } : {}) };
}

/**
 * Depth-first bounded scan collecting EVERY restorable `ask_user_question`
 * interrupt. Covers both runtime shapes: the classic `values.__interrupt__`
 * entries and the langgraph-api task layout (`tasks[].interrupts[].value`),
 * which the platform 0.10 state response uses instead of merged values.
 * Parallel `ask_user_question` tool calls raise several interrupts at once;
 * resuming those requires the langgraph interrupt ids.
 */
export function findPendingQuestions(values: Record<string, unknown>, tasks?: unknown, limit = 8): PendingInterruptView[] {
  const found: PendingInterruptView[] = [];
  const seenQuestions = new Set<string>();
  const queue: unknown[] = [values.__interrupt__];
  if (Array.isArray(tasks)) {
    for (const task of tasks.slice(0, 20)) {
      if (record(task) && Array.isArray(task.interrupts)) queue.push(...task.interrupts.slice(0, 10));
    }
  }
  for (let seen = 0; queue.length && seen < 200 && found.length < limit; ) {
    const current = queue.shift();
    seen++;
    if (Array.isArray(current)) {
      if (queue.length + current.length > 400) return found;
      queue.push(...current.slice(0, 100));
    } else if (record(current)) {
      // Only the interrupt-object shape (`{id, value}`) carries the LangGraph
      // interrupt id; a bare question payload's `id` is the tool-call id.
      const interruptId = current.value !== undefined && typeof current.id === 'string' ? current.id : undefined;
      const direct = questionFrom(current.value ?? current, interruptId);
      if (direct) {
        if (!seenQuestions.has(direct.questionId)) {
          seenQuestions.add(direct.questionId);
          found.push(direct);
        }
      } else {
        if (current.value !== undefined) queue.push(current.value);
        if (current.__interrupt__ !== undefined) queue.push(current.__interrupt__);
      }
    }
  }
  return found;
}

/** First pending `ask_user_question` interrupt, or null (W11 single-question shape). */
export function findPendingQuestion(values: Record<string, unknown>, tasks?: unknown): PendingInterruptView | null {
  return findPendingQuestions(values, tasks, 1)[0] ?? null;
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
