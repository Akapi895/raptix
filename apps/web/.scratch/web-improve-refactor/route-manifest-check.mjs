/**
 * Ticket 69 route-manifest gate: compare the keys exported by the live route
 * registry (src/router/registry.tsx MANIFEST) and each screen slice's exported
 * `routes` record against the reconciled 55-key inventory (route-inventory-reconciled.md, P00).
 * Supersedes the frozen 53-key list from the final
 * verification plan (section 4). Read-only; exits non-zero on mismatch.
 *
 * Usage: node route-manifest-check.mjs [appSrcDir]
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = process.argv[2] || 'src'

/** Reconciled inventory (P00, 2026-10-19): 55 MANIFEST keys, group = registry slice. */
const FROZEN = {
  a: ['login', 'forbidden', 'notfound', 'error', 'offline', 'session-expired', 'states', 'overview', 'command-center', 'tasks'],
  b: ['projects', 'project-new', 'project'],
  c: ['operations', 'operation-new', 'preflight', 'operation-schedule', 'operation'],
  d: ['agent', 'assets', 'asset-new', 'asset-scope', 'asset', 'playbooks', 'playbook', 'technique', 'playbook-review'],
  e: ['analysis', 'findings', 'finding-new', 'finding', 'evidence', 'evidence-inspector'],
  f: ['reports', 'report-new', 'report', 'report-preview', 'report-review', 'settings'],
  g: ['ai-operator', 'ai-plan', 'ai-plan-review', 'ai-plan-compare', 'ai-trace', 'ai-history', 'ai-fanout', 'ai-branch'],
  h: ['c2-channel', 'c2-session', 'c2-console'],
  i: ['infrastructure', 'agents', 'c2'],
  s: ['scenarios', 'workspaces'],
}
const FROZEN_KEYS = Object.values(FROZEN).flat()

/** Extracts the object-literal body after `marker`, scanning balanced braces. */
function literalBody(src, marker) {
  const start = src.indexOf(marker)
  if (start < 0) return null
  const open = src.indexOf('{', start)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open + 1, i) }
  }
  return null
}

/** Parses `key: value` pairs; keys may be quoted or bare identifiers. */
function parseKeys(body) {
  const keys = []
  const re = /(?:^|[,{\s])\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z][\w-]*))\s*:/g
  for (const m of body.matchAll(re)) {
    const k = m[1] || m[2] || m[3]
    // `default:` appears inside React.lazy route wrappers (`.then((m) => ({ default: m.X }))`)
    // and is the lazy-component contract, never a route key.
    if (k !== 'default') keys.push(k)
  }
  return keys
}

const registrySrc = readFileSync(join(SRC, 'router', 'registry.tsx'), 'utf8')
const manifestBody = literalBody(registrySrc, 'const MANIFEST')
if (!manifestBody) { console.error('MANIFEST block not found'); process.exit(2) }
const pairs = [...manifestBody.matchAll(/(?:'([^']+)')\s*:\s*'([a-is])'/g)]
const bare = [...manifestBody.matchAll(/(?:^|[,{\s])([A-Za-z][\w-]*)\s*:\s*'([a-is])'/g)]
const actual = new Map()
for (const [, key, slice] of [...pairs, ...bare]) actual.set(key, slice)
if (/\bdashboard\b/.test(manifestBody)) { console.error('FAIL: a dashboard alias exists in the manifest'); process.exit(2) }

const actualKeys = [...actual.keys()]
const frozenSet = new Set(FROZEN_KEYS)
const actualSet = new Set(actualKeys)
const missing = FROZEN_KEYS.filter((k) => !actualSet.has(k))
const extra = actualKeys.filter((k) => !frozenSet.has(k))
const groupMismatch = Object.entries(FROZEN).flatMap(([g, keys]) => keys.filter((k) => actual.get(k) !== g).map((k) => `${k}: frozen=${g} actual=${actual.get(k)}`))

console.log(`frozen inventory: ${FROZEN_KEYS.length} keys | registry MANIFEST: ${actualKeys.length} keys`)
const groupCounts = {}
for (const k of actualKeys) groupCounts[actual.get(k)] = (groupCounts[actual.get(k)] || 0) + 1
console.log('actual group counts:', JSON.stringify(groupCounts), '(frozen:', JSON.stringify(Object.fromEntries(Object.entries(FROZEN).map(([g, keys]) => [g, keys.length]))) + ')')

const sliceFailures = []
/** A slice may export its routes record directly (a/c/f/s) or compose it from
 *  named sub-records (`...agentRoutes`). Follow one spread level, then also
 *  verify each referenced sub-record in its own file. */
function sliceExportedKeys(slice, file, src) {
  const body = literalBody(src, 'export const routes')
  if (!body) return { keys: null, file }
  const bare = parseKeys(body)
  const spreads = [...body.matchAll(/\.\.\.(\w+)/g)].map((m) => m[1])
  const keys = new Set(bare)
  for (const name of spreads) {
    const imp = new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*'([^']+)'`).exec(src)
      || new RegExp(`import\\s*\\{\\s*${name}\\b[^}]*\\}\\s*from\\s*'([^']+)'`).exec(src)
    if (!imp) { sliceFailures.push(`${file}: spread "${name}" import not found`); continue }
    const rel = imp[1].replace(/^\.\/|^(\.\.\/)+screens\//, '')
    const subFile = join(SRC, 'screens', `${rel}.tsx`)
    const subSrc = readFileSync(subFile, 'utf8')
    // The spread's local alias may re-export the sub-file's `routes` record.
    const subBody = literalBody(subSrc, 'export const routes') ?? literalBody(subSrc, `export const ${name}`)
    if (!subBody) { sliceFailures.push(`${subFile}: record "${name}" not found`); continue }
    for (const k of parseKeys(subBody)) keys.add(k)
  }
  return { keys, file }
}
for (const [slice, keys] of Object.entries(FROZEN)) {
  const sliceFile = { s: join('demo', 'pages'), i: 'infrastructure' }
  const file = join(SRC, 'screens', `${sliceFile[slice] ?? slice}.tsx`)
  const src = readFileSync(file, 'utf8')
  const { keys: exported } = sliceExportedKeys(slice, file, src)
  for (const k of keys) if (!exported.has(k)) sliceFailures.push(`${file}: key "${k}" missing from exported routes record`)
  const foreign = [...exported].filter((k) => !frozenSet.has(k))
  if (foreign.length) sliceFailures.push(`${file}: exports non-manifest route key(s): ${foreign.join(', ')}`)
}

const setEqual = missing.length === 0 && extra.length === 0 && groupMismatch.length === 0
console.log('set equality frozen vs registry:', setEqual ? 'EQUAL' : 'MISMATCH')
if (missing.length) console.log('  missing from registry:', missing.join(', '))
if (extra.length) console.log('  extra in registry:', extra.join(', '))
if (groupMismatch.length) console.log('  slice assignment mismatches:', groupMismatch.join(', '))
console.log('dashboard alias:', actualSet.has('dashboard') ? 'PRESENT (FAIL)' : 'absent (as frozen)')
if (sliceFailures.length) { console.log('slice route-record failures:'); for (const f of sliceFailures) console.log('  ' + f) }
else console.log('every registry key resolves in its slice module routes record; no slice exports foreign keys')

process.exit(setEqual && sliceFailures.length === 0 ? 0 : 1)
