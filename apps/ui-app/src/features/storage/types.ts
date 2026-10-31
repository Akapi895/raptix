// internal/storage/{category,cleaner,usage}.go and config.StorageConfig.
export type ApiFetch = (url: string, init?: RequestInit) => Promise<Response>;
export type Translate = (key: string) => string;
export interface StorageDependencies {
  translate: Translate;
  confirm(message: string): boolean;
  alert(message: string): void;
}
export interface CategoryPolicy { enabled: boolean; retention_days: number }
export interface StoragePolicy {
  auto_clean: boolean; interval_minutes: number; orphan_grace_days: number; active_grace_hours: number;
  categories: Record<string, CategoryPolicy>;
}
export interface StorageCategory extends CategoryPolicy {
  key: string; label: string; hint?: string; default_retention?: number;
}
export interface StorageMeta extends Omit<StoragePolicy, 'categories'> { categories: StorageCategory[] }
export interface StorageCounts {
  bytes?: number; units?: number; reclaimable_bytes?: number; reclaimable_units?: number;
  freed_bytes?: number; removed_units?: number; skipped_active?: number;
}
export interface CategoryReport extends StorageCounts {
  key: string; label?: string; hint?: string; root?: string; missing?: boolean; orphan_units?: number; errors?: string[];
  enabled?: boolean; retention_days?: number; skipped_unsafe?: number; removed_empty_dirs?: number;
}
export interface StorageReport {
  dry_run?: boolean; trigger?: string; started_at?: string; duration_ms?: number; note?: string;
  scanned_at?: string; totals?: StorageCounts; categories?: CategoryReport[];
  filesystem?: { path?: string; available?: boolean; used_bytes?: number; free_bytes?: number; total_bytes?: number; used_percent?: number; inodes_total?: number; inodes_free?: number };
}
