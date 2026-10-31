import { record } from '../chat/stream';

export interface ContextSummary { provenance: 'system_generated_summary'; content: string }

/** Keep server ordering and repeated summaries: distinct compaction runs may repeat content. */
export function contextSummaries(chain: unknown): ContextSummary[] {
    const summaries = record(chain).context_summaries;
    if (!Array.isArray(summaries)) return [];
    return summaries.flatMap(value => {
        const item = record(value);
        return item.provenance === 'system_generated_summary' && typeof item.content === 'string' && item.content.trim()
            ? [{ provenance: 'system_generated_summary' as const, content: item.content }] : [];
    });
}
