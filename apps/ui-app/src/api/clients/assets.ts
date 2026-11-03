import { z } from 'zod';
import { http } from '../../platform/http';
import { assetSchema, assetListSchema, assetImportResultSchema, type AssetInput, type AssetQuery } from '../types/asset';
import { type ApiOptions } from '../types/common';

// Unscanned assets store null for last_scan_at. Go's *time.Time with omitempty
// omits the field. Keep the DTO output Go-shaped.
// Sparse rows created by the mock import still need Go field/timestamp parity;
// do not fabricate missing first_seen_at/last_seen_at values here.
const assetResponseSchema = z.preprocess((value) => {
  if (value && typeof value === 'object' && 'last_scan_at' in value && value.last_scan_at === null) {
    return { ...value, last_scan_at: undefined };
  }
  return value;
}, assetSchema);
const listResponseSchema = assetListSchema.extend({ assets: z.array(assetResponseSchema) });
// security.js's legacy mock import always appends, never updates; its imported
// count is therefore exactly the created count, with zero updates.
const importResponseSchema = z.preprocess((value) => {
  if (value && typeof value === 'object' && !('created' in value) && 'imported' in value &&
    typeof value.imported === 'number' && 'skipped' in value) {
    return { created: value.imported, updated: 0, skipped: value.skipped };
  }
  return value;
}, assetImportResultSchema);

// internal/app/app.go routes; internal/handler/asset.go contracts. There is no
// GET /assets/:id or POST /assets route: creation happens through /assets/import.
export function createAssetsClient(transport = http) {
  const path = (id: string) => `/api/assets/${encodeURIComponent(id)}`;
  return {
    list: (query: AssetQuery = {}, options: ApiOptions = {}) => transport.get('/api/assets', { ...options, query, schema: listResponseSchema }),
    import: (assets: AssetInput[], source?: string, source_query?: string, options: ApiOptions = {}) => transport.post('/api/assets/import', { assets, source, source_query }, { ...options, schema: importResponseSchema }),
    update: (id: string, body: AssetInput, options: ApiOptions = {}) => transport.put(path(id), body, { ...options, schema: assetResponseSchema }),
    async delete(id: string, options: ApiOptions = {}): Promise<void> {
      await transport.delete<unknown>(path(id), options);
    },
  };
}
export const assets = createAssetsClient();
