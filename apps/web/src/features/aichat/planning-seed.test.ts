import { beforeEach, describe, expect, it } from 'vitest'
import { clearPlanningSeed, hasPlanningSeed, markPlanningSeed, planningSeedMessage } from './planning-seed'

beforeEach(() => { window.sessionStorage.clear() })

describe('planning seed flag', () => {
  it('stays set until the first message is dispatched, so a runtime that is not ready yet keeps it', () => {
    markPlanningSeed('eng-1')
    expect(hasPlanningSeed('eng-1')).toBe(true)
    expect(hasPlanningSeed('eng-1')).toBe(true)
    clearPlanningSeed('eng-1')
    expect(hasPlanningSeed('eng-1')).toBe(false)
  })

  it('is scoped to the engagement it was set for', () => {
    markPlanningSeed('eng-1')
    expect(hasPlanningSeed('eng-2')).toBe(false)
    expect(hasPlanningSeed('eng-1')).toBe(true)
  })
})

describe('planningSeedMessage', () => {
  it('carries the declared target and the operator brief verbatim', () => {
    const message = planningSeedMessage({ displayName: 'Lab', targetType: 'ip_range', targetValue: '10.129.227.140', brief: '  Assess the lab host.  ' })
    expect(message).toContain('Target (ip_range): 10.129.227.140')
    expect(message).toContain('Operator brief:\nAssess the lab host.')
  })

  it('stays honest when the brief is empty instead of inventing one', () => {
    const message = planningSeedMessage({ displayName: 'Lab', targetType: 'web_url', targetValue: 'https://lab.example.test', brief: null })
    expect(message).toContain('Operator brief:\n\n')
  })
})
