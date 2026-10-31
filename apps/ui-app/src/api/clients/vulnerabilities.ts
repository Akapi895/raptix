import { z } from 'zod';
import { http } from '../../platform/http';
import { messageResultSchema, type ApiOptions } from '../types/common';
import { vulnerabilitySchema, vulnerabilityListSchema, type CreateVulnerabilityRequest, type UpdateVulnerabilityRequest, type VulnerabilityQuery } from '../types/vulnerability';

// GET /api/vulnerabilities omits total_pages. Normalize that one legacy
// difference before validating the Go DTO.
const listResponseSchema = z.preprocess((value) => {
  if (value && typeof value === 'object' && !('total_pages' in value) &&
    'total' in value && typeof value.total === 'number' &&
    'page_size' in value && typeof value.page_size === 'number' && value.page_size > 0) {
    return { ...value, total_pages: Math.max(1, Math.ceil(value.total / value.page_size)) };
  }
  return value;
}, vulnerabilityListSchema);

// internal/app/app.go routes; internal/handler/vulnerability.go contracts.
export function createVulnerabilitiesClient(transport = http) {
  const path = (id: string) => `/api/vulnerabilities/${encodeURIComponent(id)}`;
  return {
    list: (query: VulnerabilityQuery = {}, options: ApiOptions = {}) => transport.get('/api/vulnerabilities', { ...options, query, schema: listResponseSchema }),
    get: (id: string, options: ApiOptions = {}) => transport.get(path(id), { ...options, schema: vulnerabilitySchema }),
    create: (body: CreateVulnerabilityRequest, options: ApiOptions = {}) => transport.post('/api/vulnerabilities', body, { ...options, schema: vulnerabilitySchema }),
    update: (id: string, body: UpdateVulnerabilityRequest, options: ApiOptions = {}) => transport.put(path(id), body, { ...options, schema: vulnerabilitySchema }),
    delete: (id: string, options: ApiOptions = {}) => transport.delete(path(id), { ...options, schema: messageResultSchema }),
  };
}
export const vulnerabilities = createVulnerabilitiesClient();
