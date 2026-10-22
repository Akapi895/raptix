/** W07: timezone-true window conversion — the API machine's clock must never shift an authorized window. */
import { describe, expect, it } from 'vitest'
import { zonedToIso } from './format'

describe('zonedToIso', () => {
  it('treats UTC selections as UTC instants', () => {
    expect(zonedToIso('2026-10-15T10:00', 'UTC')).toBe('2026-10-15T10:00:00.000Z')
  })

  it('converts Asia/Ho_Chi_Minh entries to their +07:00 instants', () => {
    expect(zonedToIso('2026-10-15T10:00', 'Asia/Ho_Chi_Minh')).toBe('2026-10-15T03:00:00.000Z')
    expect(zonedToIso('2026-10-15T00:30', 'Asia/Ho_Chi_Minh')).toBe('2026-10-14T17:30:00.000Z')
  })

  it('resolves DST boundaries in the selected zone, not the machine zone', () => {
    expect(zonedToIso('2026-07-15T09:00', 'Europe/Berlin')).toBe('2026-07-15T07:00:00.000Z')
    expect(zonedToIso('2026-12-15T09:00', 'Europe/Berlin')).toBe('2026-12-15T08:00:00.000Z')
  })

  it('refuses naive garbage instead of inventing an instant', () => {
    expect(() => zonedToIso('not-a-date', 'UTC')).toThrow()
  })
})
