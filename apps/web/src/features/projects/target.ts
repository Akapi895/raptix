import type { EngagementTargetType } from '@raptix/web-contracts'

const WEB_URL_RE = /^https?:\/\/\S+$/i
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/
const IPV6_RE = /^[0-9a-f:]+(\/\d{1,3})?$/i

/**
 * The target type a target value describes, or null when it is neither a web URL nor an IP address or CIDR range.
 * The server validates the value again; this only chooses the type, so an IP target needs no http(s) prefix.
 */
export function targetTypeOf(value: string): EngagementTargetType | null {
  const trimmed = value.trim()
  if (WEB_URL_RE.test(trimmed)) return 'web_url'
  if (IPV4_RE.test(trimmed) || (trimmed.includes(':') && IPV6_RE.test(trimmed))) return 'ip_range'
  return null
}
