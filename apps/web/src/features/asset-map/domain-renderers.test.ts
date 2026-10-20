import { describe, expect, it } from 'vitest'
import { rendererFor, rendererLabel } from './domain-renderers'

describe('domain renderers', () => {
  it('gives hosts and DNS names the services view and web origins the sitemap view', () => {
    expect(rendererFor('host')).toBe('services')
    expect(rendererFor('dns_name')).toBe('services')
    expect(rendererFor('web_origin')).toBe('sitemap')
  })

  it('gives every other kind the typed fallback, never the host list', () => {
    for (const kind of ['identity', 'device', 'artifact', 'cloud_resource', 'mobile_app', 'network_segment', 'unknown-kind']) {
      expect(rendererFor(kind)).toBe('typed-fallback')
    }
  })

  it('names the view on screen, so a fallback is never shown as a typed view', () => {
    expect(rendererLabel(rendererFor('host'))).toBe('Typed view: services')
    expect(rendererLabel(rendererFor('web_origin'))).toBe('Typed view: sitemap')
    expect(rendererLabel(rendererFor('device'))).toBe('No typed view yet')
  })
})
