import { describe, expect, it } from 'vitest'
import { countText, splitTasks } from './model'

describe('splitTasks', () => {
  it('keeps active emergency stops out of the decisions and keeps the read order', () => {
    const tasks = [{ kind: 'c2-grant', refId: 'g1' }, { kind: 'active-stop', refId: 's1' }, { kind: 'scope-revision', refId: 'r1' }]
    const split = splitTasks(tasks)
    expect(split.decisions.map((task) => task.refId)).toEqual(['g1', 'r1'])
    expect(split.stops.map((task) => task.refId)).toEqual(['s1'])
  })

  it('returns no decisions when the only pending item is a stop', () => {
    expect(splitTasks([{ kind: 'active-stop', refId: 's1' }]).decisions).toEqual([])
  })
})

describe('countText', () => {
  it('shows an exact count as its number', () => {
    expect(countText(3, false)).toBe('3')
  })

  it('marks a limited count as a lower bound', () => {
    expect(countText(25, true)).toBe('25+')
  })
})
