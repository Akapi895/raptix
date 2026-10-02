import { describe, expect, it } from 'vitest'
import { ACTIVE_NAV_ITEMS } from '../../src/app/navigation'
import { parseRoute } from '../../src/app/router'
import {
  REAL_FALLBACK_REASON,
  REAL_UNAVAILABLE_REASONS,
  toCreateFormError,
} from '../../src/app/real-capabilities'
import { ApiNetworkError, ApiStatusError } from '../../src/shared/api/errors'

describe('real workspace capabilities (W03 composition)', () => {
  it('gives unconnected pages a truthful reason while Charter/Scope/Console/Findings/Infrastructure/Assets/Logs/Reports are mounted real', () => {
    for (const item of ACTIVE_NAV_ITEMS) {
      if (item.id === 'charter' || item.id === 'scope-boundaries' || item.id === 'operator-console' || item.id === 'findings' || item.id === 'infrastructure' || item.id === 'assets' || item.id === 'logs' || item.id === 'reports') {
        expect(REAL_UNAVAILABLE_REASONS[item.id], `${item.id} is connected and must not be listed unavailable`).toBeUndefined()
        continue
      }
      expect(REAL_UNAVAILABLE_REASONS[item.id], `missing reason for ${item.id}`).toBeTruthy()
    }
  })

  it('keeps the default workspace screen on charter via the native router', () => {
    expect(parseRoute('/projects/eng_1').screen).toBe('charter')
    expect(parseRoute('/projects/eng_1/charter').screen).toBe('charter')
  })

  it('maps create failures to the peer form error without inventing field names', () => {
    const conflict = new ApiStatusError(409, 'conflict', 'duplicate slug')
    expect(toCreateFormError(conflict)).toEqual({ message: 'duplicate slug', field: 'name' })
    const invalid = new ApiStatusError(400, 'bad_request', 'invalid target')
    expect(toCreateFormError(invalid)).toEqual({ message: 'invalid target' })
    expect(toCreateFormError(new ApiNetworkError())).toEqual({ message: 'Network request failed' })
    expect(toCreateFormError('boom')).toEqual({ message: 'Project creation failed. Try again.' })
  })

  it('falls back to a generic truthful reason for unexpected screens', () => {
    expect(REAL_FALLBACK_REASON).toContain('no connected backend source')
    expect(REAL_FALLBACK_REASON).toContain('No demo data')
  })
})
