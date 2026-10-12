/**
 * Real-mode ProjectsApi over the new API (127.0.0.1:5280 through the Vite
 * /api proxy). Every response is validated with `isProjectViewModel` at the
 * boundary — malformed payloads become errors, never cast DTOs. Nullable
 * counts are passed through as delivered (no fake normalization), and
 * `metadataState`/`source` provenance is preserved untouched.
 */
import { isProjectViewModel } from '@raptix/web-contracts'
import type { ProjectViewModel } from '@raptix/web-contracts'
import { apiBaseUrl } from '../../../app/config'
import { ApiInvalidResponseError } from '../../../shared/api/errors'
import { MUTATION_TIMEOUT_MS, encodePathSegment, requestJson } from '../../../shared/api/http'
import type { ProjectPatch, ProjectsApi } from './projects-api'

/** Paths are relative to the API base URL prefix (default '/api'). */
const ENGAGEMENTS_PATH = '/engagements'

function assertProjectViewModel(value: unknown, context: string): ProjectViewModel {
  if (isProjectViewModel(value)) return value
  throw new ApiInvalidResponseError(`${context} did not match the ProjectViewModel contract`)
}

function assertProjectList(value: unknown): readonly ProjectViewModel[] {
  if (!Array.isArray(value)) throw new ApiInvalidResponseError('Project list was not an array')
  return value.map(item => assertProjectViewModel(item, 'Project list entry'))
}

export function createRealProjectsApi(baseUrl: string = apiBaseUrl): ProjectsApi {
  return {
    list(signal) {
      return requestJson<unknown>(baseUrl, ENGAGEMENTS_PATH, { signal, retries: 1 })
        .then(assertProjectList)
    },
    async get(id, signal) {
      const value = await requestJson<unknown>(
        baseUrl, `${ENGAGEMENTS_PATH}/${encodePathSegment(id)}`, { signal, retries: 1 },
      )
      return assertProjectViewModel(value, `Project ${id}`)
    },
    async create(input) {
      const payload = {
        name: input.name,
        ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
        targetType: input.targetType,
        targetValue: input.targetValue,
        authorizationConfirmed: true as const,
        brief: input.brief,
      }
      const value = await requestJson<unknown>(
        baseUrl, ENGAGEMENTS_PATH,
        { method: 'POST', body: payload, timeoutMs: MUTATION_TIMEOUT_MS },
      )
      return assertProjectViewModel(value, 'Created project')
    },
    async updateSupportedFields(id, patch) {
      const payload: ProjectPatch = {
        ...(patch.displayName === undefined ? {} : { displayName: patch.displayName }),
        ...(patch.targetType === undefined ? {} : { targetType: patch.targetType }),
        ...(patch.targetValue === undefined ? {} : { targetValue: patch.targetValue }),
        ...(patch.handoffConfirmed === undefined ? {} : { handoffConfirmed: patch.handoffConfirmed }),
      }
      const value = await requestJson<unknown>(
        baseUrl, `${ENGAGEMENTS_PATH}/${encodePathSegment(id)}`,
        { method: 'PATCH', body: payload, timeoutMs: MUTATION_TIMEOUT_MS },
      )
      return assertProjectViewModel(value, `Updated project ${id}`)
    },
  }
}

export const realProjectsApi: ProjectsApi = createRealProjectsApi()
