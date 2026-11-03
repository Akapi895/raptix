import { z } from 'zod';

// Go time.Time JSON uses RFC3339 with optional fractional seconds and offsets.
export const timestampSchema = z.iso.datetime({ offset: true });
export const messageResultSchema = z.looseObject({ message: z.string() });
export const successResultSchema = z.looseObject({ success: z.boolean() });
export type ApiOptions = { signal?: AbortSignal };

// Pagination envelopes remain domain-specific; names differ across Go handlers.
export const offsetFields = { total: z.number().int(), limit: z.number().int(), offset: z.number().int() };
export const pageFields = {
  total: z.number().int(), page: z.number().int(), page_size: z.number().int(), total_pages: z.number().int(),
};
