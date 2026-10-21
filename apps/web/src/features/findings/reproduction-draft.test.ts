import { describe, expect, it } from 'vitest'
import { draftFromReproduction, draftReproductionPayload, EMPTY_REPRODUCTION } from './reproduction-draft'

describe('reproduction draft payload', () => {
  it('sends null when the operator removed the package, so the server clears what it stored', () => {
    expect(draftReproductionPayload(null)).toBeNull()
  })

  it('sends nothing when the package was never touched, so the server keeps what it stored', () => {
    expect(draftReproductionPayload(undefined)).toBeUndefined()
    expect(draftFromReproduction(undefined)).toBeUndefined()
  })

  it('trims the text and drops blank steps before the package is sent', () => {
    expect(draftReproductionPayload({ ...EMPTY_REPRODUCTION, prerequisites: '  Lab reachable  ', steps: ['Open /admin ', '   ', 'Read the response'] })).toEqual({
      prerequisites: 'Lab reachable', inputs: '', steps: ['Open /admin', 'Read the response'], expectedObservation: '', limitations: '', artifact: null,
    })
  })
})
