/**
 * The mock console's display labels read the factory's injected clock. Advancing that clock moves the stamp, the minute label and the
 * second label together, so a timestamp written from a migrated path follows the dataset time, not the host.
 */
import { describe, expect, it } from 'vitest'
import { createConsoleServices } from './services'

describe('mock display labels follow the injected clock', () => {
  it('the stamp, minute and second labels advance with the clock they were built from', () => {
    const services = createConsoleServices()
    try {
      expect(services.display.stamp()).toBe('Oct 13, 2026, 10:42 AM (UTC+7)')
      expect(services.display.hhmm()).toBe('10:42')
      expect(services.display.hhmmss()).toMatch(/^10:42:\d{2}$/)
      services.clock.advance((2 * 60 + 5) * 60 * 1000 + 7 * 1000)
      expect(services.display.stamp()).toBe('Oct 13, 2026, 12:47 PM (UTC+7)')
      expect(services.display.hhmm()).toBe('12:47')
      expect(services.display.hhmmss()).toBe('12:47:07')
    } finally {
      services.dispose()
    }
  })
})
