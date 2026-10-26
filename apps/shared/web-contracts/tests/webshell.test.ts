import { describe, expect, it } from 'vitest'

import {
  isWebShellAcquisitionCreateInput,
  isWebShellAcquisitionView,
  isWebShellCommandCreateInput,
  isWebShellCommandView,
  isWebShellConnectionCreateInput,
  isWebShellConnectionView,
  isWebShellProbeView,
  isWebShellProfile,
} from '../src/webshell.js'

const PROFILE = {
  provider: 'http-form-command',
  target: '10.129.88.4',
  endpoint: 'http://10.129.88.4/dev/phpbash.php',
  method: 'POST',
  content_type: 'application/x-www-form-urlencoded',
  command_parameter: 'cmd',
  headers: { 'User-Agent': 'Bashed-RT/1.0' },
  probe_command: 'id;hostname',
  probe_pattern: 'uid=33',
  expected_user: 'www-data',
}

const NOW = '2026-10-26T07:00:00.000Z'
const HASH = 'a'.repeat(64)

const PROBE = {
  id: 'probe-1',
  connectionId: 'conn-1',
  engagementId: 'eng-1',
  requestId: 'req-00000001',
  state: 'reachable',
  httpStatus: 200,
  matched: true,
  output: 'uid=33(www-data)',
  outputTruncated: false,
  error: null,
  durationMs: 42,
  createdAt: NOW,
}

const CONNECTION = {
  id: 'conn-1',
  engagementId: 'eng-1',
  name: 'phpbash',
  assetId: null,
  profile: PROFILE,
  state: 'reachable',
  source: 'poc_acquisition',
  createdBy: 'local',
  producerFindingId: 'FIND-001',
  producerPocSha256: HASH,
  producerSpecSha256: HASH,
  producerAcquisitionId: 'acq-1',
  lastProbeState: 'reachable',
  lastProbeAt: NOW,
  concurrencyVersion: 1,
  createdAt: NOW,
  updatedAt: NOW,
}

const COMMAND = {
  id: 'cmd-1',
  connectionId: 'conn-1',
  engagementId: 'eng-1',
  requestId: 'req-00000002',
  command: 'id;hostname',
  status: 'delivered',
  httpStatus: 200,
  exitCode: null,
  output: 'uid=33(www-data)',
  outputTruncated: false,
  error: null,
  actorId: 'local',
  runId: null,
  invocationId: null,
  createdAt: NOW,
  updatedAt: NOW,
}

const ACQUISITION = {
  id: 'acq-1',
  engagementId: 'eng-1',
  findingId: 'FIND-001',
  requestId: 'req-00000003',
  mode: 'derive',
  state: 'succeeded',
  attempt: 1,
  maxAttempts: 2,
  pocSha256: HASH,
  specSha256: HASH,
  profile: PROFILE,
  connectionId: 'conn-1',
  error: null,
  artifactPath: 'webshell/acquisitions/acq-1.json',
  artifactSha256: HASH,
  actorId: 'local',
  createdAt: NOW,
  updatedAt: NOW,
}

describe('WebShell profile', () => {
  it('accepts the bashed phpbash profile', () => {
    expect(isWebShellProfile(PROFILE)).toBe(true)
  })

  it('accepts the profile without optional headers and expected user', () => {
    const { headers: _headers, expected_user: _expected, ...minimal } = PROFILE
    expect(isWebShellProfile(minimal)).toBe(true)
  })

  it('refuses a provider, method, or content type outside the MVP', () => {
    expect(isWebShellProfile({ ...PROFILE, provider: 'bind-shell' })).toBe(false)
    expect(isWebShellProfile({ ...PROFILE, method: 'GET' })).toBe(false)
    expect(isWebShellProfile({ ...PROFILE, content_type: 'application/json' })).toBe(false)
  })

  it('refuses an endpoint that is not a bare http(s) URL', () => {
    expect(isWebShellProfile({ ...PROFILE, endpoint: 'ftp://10.129.88.4/dev/phpbash.php' })).toBe(false)
    expect(isWebShellProfile({ ...PROFILE, endpoint: 'http://user:pass@10.129.88.4/dev/phpbash.php' })).toBe(false)
    expect(isWebShellProfile({ ...PROFILE, endpoint: 'http://10.129.88.4/dev/phpbash.php#frag' })).toBe(false)
    expect(isWebShellProfile({ ...PROFILE, endpoint: 'http://10.129.88.4:0/dev/phpbash.php' })).toBe(false)
    expect(isWebShellProfile({ ...PROFILE, endpoint: 'http://10.129.88.4:70000/dev/phpbash.php' })).toBe(false)
    expect(isWebShellProfile({ ...PROFILE, endpoint: 'http://10.129.88.4:abc/dev/phpbash.php' })).toBe(false)
    expect(isWebShellProfile({ ...PROFILE, endpoint: 'http://10.129.88.4.evil/dev/phpbash.php' })).toBe(false)
  })

  it('refuses a target that does not match the endpoint host', () => {
    expect(isWebShellProfile({ ...PROFILE, target: '10.129.88.5' })).toBe(false)
    expect(isWebShellProfile({ ...PROFILE, target: '10.129.88.4:8080' })).toBe(false)
  })

  it('accepts an endpoint port and an IPv6 host', () => {
    expect(isWebShellProfile({ ...PROFILE, endpoint: 'https://10.129.88.4:8443/dev/phpbash.php' })).toBe(true)
    expect(isWebShellProfile({ ...PROFILE, target: '::1', endpoint: 'http://[::1]:8080/x.php' })).toBe(true)
  })

  it('refuses an invalid command parameter', () => {
    expect(isWebShellProfile({ ...PROFILE, command_parameter: 'x cmd' })).toBe(false)
    expect(isWebShellProfile({ ...PROFILE, command_parameter: '1cmd' })).toBe(false)
    expect(isWebShellProfile({ ...PROFILE, command_parameter: '' })).toBe(false)
  })

  it('allows only User-Agent and a form Content-Type header', () => {
    expect(isWebShellProfile({ ...PROFILE, headers: { 'user-agent': 'x' } })).toBe(true)
    expect(isWebShellProfile({ ...PROFILE, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).toBe(true)
    expect(isWebShellProfile({ ...PROFILE, headers: { Authorization: 'Bearer x' } })).toBe(false)
    expect(isWebShellProfile({ ...PROFILE, headers: { Cookie: 'a=b' } })).toBe(false)
    expect(isWebShellProfile({ ...PROFILE, headers: { 'Content-Type': 'application/json' } })).toBe(false)
    expect(isWebShellProfile({ ...PROFILE, headers: { 'User-Agent': 'a\r\nb' } })).toBe(false)
  })

  it('refuses a probe command with control characters', () => {
    expect(isWebShellProfile({ ...PROFILE, probe_command: 'id\nhostname' })).toBe(false)
    expect(isWebShellProfile({ ...PROFILE, probe_command: '' })).toBe(false)
  })

  it('refuses a weak or invalid probe pattern', () => {
    expect(isWebShellProfile({ ...PROFILE, probe_pattern: 'uid=33,' })).toBe(false)
    expect(isWebShellProfile({ ...PROFILE, probe_pattern: '.*' })).toBe(false)
    expect(isWebShellProfile({ ...PROFILE, probe_pattern: '[' })).toBe(false)
    expect(isWebShellProfile({ ...PROFILE, probe_pattern: 'abc' })).toBe(false)
  })

  it('refuses unknown profile keys', () => {
    expect(isWebShellProfile({ ...PROFILE, curl: 'curl http://x' })).toBe(false)
  })
})

describe('WebShell request inputs', () => {
  it('accepts a manual connection request', () => {
    expect(isWebShellConnectionCreateInput({ requestId: 'req-00000001', name: 'phpbash', profile: PROFILE })).toBe(true)
    expect(isWebShellConnectionCreateInput({ requestId: 'req-00000001', name: 'phpbash', profile: PROFILE, assetId: 'asset-1' })).toBe(true)
  })

  it('refuses a short request id, a bad name, or an invalid profile', () => {
    expect(isWebShellConnectionCreateInput({ requestId: 'short', name: 'phpbash', profile: PROFILE })).toBe(false)
    expect(isWebShellConnectionCreateInput({ requestId: 'req-00000001', name: '', profile: PROFILE })).toBe(false)
    expect(isWebShellConnectionCreateInput({ requestId: 'req-00000001', name: 'phpbash', profile: { ...PROFILE, method: 'GET' } })).toBe(false)
  })

  it('accepts a bounded command and refuses NUL', () => {
    expect(isWebShellCommandCreateInput({ requestId: 'req-00000002', command: 'id;hostname' })).toBe(true)
    expect(isWebShellCommandCreateInput({ requestId: 'req-00000002', command: 'id\u0000hostname' })).toBe(false)
    expect(isWebShellCommandCreateInput({ requestId: 'req-00000002', command: '' })).toBe(false)
  })

  it('accepts a finding acquisition and the derive/refine modes', () => {
    expect(isWebShellAcquisitionCreateInput({ requestId: 'req-00000003', findingId: 'FIND-001' })).toBe(true)
    expect(isWebShellAcquisitionCreateInput({ requestId: 'req-00000003', findingId: 'FIND-001', mode: 'refine' })).toBe(true)
    expect(isWebShellAcquisitionCreateInput({ requestId: 'req-00000003', findingId: 'FIND-' })).toBe(false)
    expect(isWebShellAcquisitionCreateInput({ requestId: 'req-00000003', findingId: 'FIND-001', mode: 'plant' })).toBe(false)
  })
})

describe('WebShell response views', () => {
  it('accepts the probe, connection, command and acquisition views', () => {
    expect(isWebShellProbeView(PROBE)).toBe(true)
    expect(isWebShellConnectionView(CONNECTION)).toBe(true)
    expect(isWebShellCommandView(COMMAND)).toBe(true)
    expect(isWebShellAcquisitionView(ACQUISITION)).toBe(true)
  })

  it('refuses unknown states and malformed hashes', () => {
    expect(isWebShellProbeView({ ...PROBE, state: 'connected' })).toBe(false)
    expect(isWebShellConnectionView({ ...CONNECTION, state: 'connected' })).toBe(false)
    expect(isWebShellConnectionView({ ...CONNECTION, producerPocSha256: 'abc' })).toBe(false)
    expect(isWebShellCommandView({ ...COMMAND, status: 'succeeded' })).toBe(false)
    expect(isWebShellAcquisitionView({ ...ACQUISITION, state: 'connected' })).toBe(false)
  })

  it('requires an HTTP status only when a response was received', () => {
    expect(isWebShellProbeView({ ...PROBE, httpStatus: null })).toBe(true)
    expect(isWebShellProbeView({ ...PROBE, httpStatus: 99 })).toBe(false)
    expect(isWebShellCommandView({ ...COMMAND, httpStatus: null, status: 'uncertain' })).toBe(true)
  })

  it('bounds output and requires UTC timestamps', () => {
    expect(isWebShellCommandView({ ...COMMAND, output: 'x'.repeat(196609) })).toBe(false)
    expect(isWebShellConnectionView({ ...CONNECTION, createdAt: '2026-10-26T07:00:00+07:00' })).toBe(false)
    expect(isWebShellAcquisitionView({ ...ACQUISITION, updatedAt: 'not-a-date' })).toBe(false)
  })

  it('requires a positive concurrency version and a valid last-probe pair', () => {
    expect(isWebShellConnectionView({ ...CONNECTION, concurrencyVersion: 0 })).toBe(false)
    expect(isWebShellConnectionView({ ...CONNECTION, lastProbeState: null, lastProbeAt: NOW })).toBe(true)
    expect(isWebShellConnectionView({ ...CONNECTION, lastProbeAt: null })).toBe(true)
  })
})
