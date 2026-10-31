import { z } from 'zod';
import { pageFields, timestampSchema } from './common';

// internal/database/asset.go:Asset. RiskScore and OwnerUserID have json:"-".
export const assetSchema = z.looseObject({
  id: z.string(), project_id: z.string().optional(), project_name: z.string().optional(),
  host: z.string(), ip: z.string(), port: z.number().int(), domain: z.string(), protocol: z.string(),
  title: z.string(), server: z.string(), country: z.string(), province: z.string(), city: z.string(),
  responsible_person: z.string(), department: z.string(), business_system: z.string(), environment: z.string(),
  criticality: z.string(), source: z.string(), source_query: z.string(), status: z.string(), tags: z.array(z.string()),
  first_seen_at: timestampSchema, last_seen_at: timestampSchema, created_at: timestampSchema, updated_at: timestampSchema,
  last_scan_at: timestampSchema.optional(), last_scan_conversation_id: z.string().optional(),
  last_scan_queue_id: z.string().optional(), last_scan_task_id: z.string().optional(),
  vulnerability_count: z.number().int(), risk_level: z.string(),
});
// internal/handler/asset.go:List / Import.
export const assetListSchema = z.looseObject({ assets: z.array(assetSchema), ...pageFields });
export const assetImportResultSchema = z.looseObject({ created: z.number().int(), updated: z.number().int(), skipped: z.number().int() });
export type Asset = z.infer<typeof assetSchema>;
export type AssetList = z.infer<typeof assetListSchema>;
export type AssetImportResult = z.infer<typeof assetImportResultSchema>;

// Import and Update bind database.Asset, but only these fields are written by
// internal/database/asset.go:UpsertAssets / UpdateAsset. Update is replacement,
// not a PATCH: omitted editable strings are cleared/defaulted by Go.
export interface AssetInput {
  // validateAsset requires at least one non-empty host, ip or domain at runtime.
  host?: string; project_id?: string; ip?: string; port?: number; domain?: string; protocol?: string;
  title?: string; server?: string; country?: string; province?: string; city?: string;
  responsible_person?: string; department?: string; business_system?: string; environment?: string;
  criticality?: string; source?: string; source_query?: string; status?: string; tags?: string[];
}
export type AssetQuery = {
  page?: number; page_size?: number; q?: string; status?: string; protocol?: string; project_id?: string;
  source?: string; tag?: string; host?: string; ip?: string; domain?: string; port?: number; risk_level?: string;
  min_vulnerabilities?: number; max_vulnerabilities?: number; country?: string; province?: string; city?: string;
  responsible_person?: string; department?: string; business_system?: string; environment?: string; criticality?: string;
  scan_state?: string; scan_overdue_days?: number; last_scan_before?: string; last_scan_after?: string;
  first_seen_before?: string; first_seen_after?: string; last_seen_before?: string; last_seen_after?: string;
  sort_by?: string; sort_order?: string;
};
