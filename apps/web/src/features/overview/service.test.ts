import { describe, expect, it } from 'vitest'
import { riskAssessment } from './service'

/**
 * The overview's risk level uses the reference's weighted score over unresolved curated findings: critical 10, high 5,
 * medium 2, low 0.5, and the thresholds 3, 10 and 30. Informational findings carry no weight.
 */
describe('riskAssessment', () => {
  it('reads no weighted finding as safe, and an informational-only backlog as safe too', () => {
    expect(riskAssessment({})).toEqual({ level: 'safe', score: 0 })
    expect(riskAssessment({ info: 7 })).toEqual({ level: 'safe', score: 0 })
  })

  it('places each score in its band, with the boundary at each threshold', () => {
    expect(riskAssessment({ low: 1 })).toEqual({ level: 'low', score: 0.5 })
    expect(riskAssessment({ low: 6 })).toEqual({ level: 'low', score: 3 })
    expect(riskAssessment({ medium: 2, low: 2 })).toEqual({ level: 'medium', score: 5 })
    expect(riskAssessment({ critical: 1 })).toEqual({ level: 'medium', score: 10 })
    expect(riskAssessment({ critical: 2 })).toEqual({ level: 'high', score: 20 })
    expect(riskAssessment({ critical: 3 })).toEqual({ level: 'high', score: 30 })
    expect(riskAssessment({ critical: 4 })).toEqual({ level: 'severe', score: 40 })
  })
})
