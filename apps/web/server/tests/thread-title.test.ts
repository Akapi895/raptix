import { describe, expect, it } from 'vitest'
import { parseThreadTitle } from '../src/http/routes/thread-title.routes.js'
import { ProjectPolicyError } from '../src/security/project-policy.js'

describe('parseThreadTitle', () => {
  it('trims a valid title', () => {
    expect(parseThreadTitle({ title: '  Recon of the web tier  ' })).toBe('Recon of the web tier')
  })

  it('refuses empty, overlong, control-character and unknown-field bodies', () => {
    expect(() => parseThreadTitle({ title: '   ' })).toThrow(ProjectPolicyError)
    expect(() => parseThreadTitle({ title: 'x'.repeat(81) })).toThrow(ProjectPolicyError)
    expect(() => parseThreadTitle({ title: 'bad\u0007bell' })).toThrow(ProjectPolicyError)
    expect(() => parseThreadTitle({ title: 'ok', threadId: 'other' })).toThrow(ProjectPolicyError)
    expect(() => parseThreadTitle({ title: 42 })).toThrow(ProjectPolicyError)
  })
})
