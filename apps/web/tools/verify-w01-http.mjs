import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const cwd = fileURLToPath(new URL('../server/', import.meta.url))
const child = spawn(process.execPath, ['dist/main.js'], { cwd, env: { ...process.env, HOST: '127.0.0.1', PORT: '5280', NODE_ENV: 'test' }, stdio: 'pipe' })
let log = ''
child.stdout.on('data', chunk => { log += chunk.toString() })
child.stderr.on('data', chunk => { log += chunk.toString() })
const results = []
try {
  let alive = false
  for (let attempt = 0; attempt < 300; attempt++) {
    if (child.exitCode !== null) throw new Error(`New API exited before liveness: ${log}`)
    try { alive = (await fetch('http://127.0.0.1:5280/api/health', { signal: AbortSignal.timeout(1000) })).status === 200 } catch { /* Process may still be starting. */ }
    if (alive) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  if (!alive) throw new Error(`New API did not start: ${log}`)
  for (const [path, expected] of [['/api/health', 200], ['/api/health/ready', 503], ['/api/capabilities', 200], ['/api/engagements', 404]]) {
    const response = await fetch(`http://127.0.0.1:5280${path}`)
    const body = await response.json()
    results.push({ path, expected, status: response.status, body })
    if (response.status !== expected) throw new Error(`Unexpected bootstrap response: ${path}`)
    if (path === '/api/capabilities' && Object.values(body.capabilities).some(capability => capability.supported || capability.available)) throw new Error('Bootstrap falsely enables a business capability')
  }
  writeFileSync(new URL('../docs/integration/w01-http.json', import.meta.url), JSON.stringify({ ok: true, results }, null, 2) + '\n')
  console.log('W01 new API liveness/readiness/capability HTTP gate passed')
} finally {
  child.kill('SIGTERM')
  await new Promise(resolve => { child.once('exit', resolve); if (child.exitCode !== null) resolve() })
}
