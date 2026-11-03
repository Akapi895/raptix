import { storage } from '../../platform/storage';
import { createAuditClient } from './client';
import { createAuditService } from './service';
import { createAuditView } from './view';
import { createAuditDatetimePicker } from './datetime-picker';
import type { AuditDependencies } from './types';
export type { AuditDependencies, AuditLog, AuditFilters, AuditPage, AuditSummary } from './types';
export { createAuditService, buildAuditQuery, auditDatetimeLocalToRFC3339, auditPresetRange, auditResourceDestination, auditResourceUnavailable } from './service';
export { createAuditClient } from './client';
export { formatAuditTime } from './labels';
export { buildMonthGrid, parseStorage, partsToStorage } from './datetime-picker';
export function initAudit(document: Document, dependencies: AuditDependencies) {
  const picker = createAuditDatetimePicker(document, dependencies);
  const view = createAuditView(document, dependencies, picker);
  const service = createAuditService(createAuditClient(), storage, view.observer);
  view.bind(service);
  return { view, service, picker, afterClassicScripts: view.mount, dispose(): void { service.dispose(); view.dispose(); picker.dispose(); } };
}
