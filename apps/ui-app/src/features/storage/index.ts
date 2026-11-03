import type { ApiFetch, StorageDependencies } from './types';
import { createStorageService } from './service';
import { createStorageView } from './view';
export function initStorage(document: Document, api: ApiFetch, dependencies: StorageDependencies) {
  return createStorageView(document, createStorageService(api, dependencies.translate), dependencies);
}
export { createStorageService, formatBytes, nonnegativeInt } from './service';
export type { ApiFetch, StorageDependencies } from './types';
export type StorageFeature = ReturnType<typeof initStorage>;
