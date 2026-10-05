import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../../cli/src/hooks/useAgent.ts', import.meta.url), 'utf8')
const start = source.indexOf('const configurable: Record<string, unknown> = {};')
const end = source.indexOf('const hasConfigurable', start)
assert.ok(start >= 0 && end > start, 'CLI submit context block changed; review capture anchors')
const block = source.slice(start, end)
const sourceHash = createHash('sha256').update(block).digest('hex')
const env = { RAPTIX_ENGAGEMENT: 'parity-project', RAPTIX_WORKSPACE_PATH: '/workspace/parity-project', RAPTIX_TARGET: 'https://authorized.invalid', RAPTIX_TARGET_TYPE: 'web_url', RAPTIX_AUTHORIZATION_CONFIRMED: 'true' }
const sandbox = { process: { env }, getModelOverride: () => '', captured: undefined }
vm.runInNewContext(ts.transpileModule(`${block}\nglobalThis.captured = configurable;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, sandbox, { timeout: 1000 })
const configurable = JSON.parse(JSON.stringify(sandbox.captured))
const program = "import sys,json,hashlib,inspect; import raptix.middleware.engagement as m; cfg=json.loads(sys.argv[1]); m._configurable_from_runnable_config=lambda:cfg; old={'engagement_name':'foreign','workspace_path':'/workspace/foreign','target_type':'web_url','target_value':'https://foreign.invalid','authorization_confirmed':False}; print('W06_CAPTURE='+json.dumps({'module':m.__file__,'hydrateSourceHash':hashlib.sha256(inspect.getsource(m._hydrate_engagement_state).encode()).hexdigest(),'fresh':m._hydrate_engagement_state({}),'existingUpdates':m._hydrate_engagement_state(old)}))"
const capture = spawnSync('docker', ['exec', 'raptix-langgraph', 'python', '-c', program, JSON.stringify(configurable)], { encoding: 'utf8', timeout: 60000 })
assert.equal(capture.status, 0, 'Installed-runtime hydration capture failed')
const line = capture.stdout.split('\n').find(line => line.startsWith('W06_CAPTURE='))
assert.ok(line)
const hydration = JSON.parse(line.slice('W06_CAPTURE='.length))
assert.deepEqual(hydration.fresh, configurable)
assert.equal(hydration.existingUpdates, null, 'Runtime now overwrites existing thread context; revisit W06 policy')
const directory = new URL('../tests/fixtures/w06/', import.meta.url)
mkdirSync(directory, { recursive: true })
writeFileSync(new URL('cli-context.json', directory), JSON.stringify({ provenance: 'CLI submit block executed from repository source; installed runtime hydration helper executed without graph runs', sourceHash, env, configurable, hydration }, null, 2) + '\n')
console.log('W06 actual CLI-source configurable and installed-runtime hydration parity captured')
