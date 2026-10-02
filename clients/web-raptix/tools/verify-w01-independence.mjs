import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('../../../', import.meta.url))
const phase = process.argv.includes('--w08') ? 'w08' : process.argv.includes('--w07') ? 'w07' : process.argv.includes('--w06') ? 'w06' : process.argv.includes('--w05') ? 'w05' : process.argv.includes('--w04') ? 'w04' : process.argv.includes('--w02') ? 'w02' : 'w01'
const target = path.join(tmpdir(), 'opencode', `raptix-${phase}-independent-${Date.now()}`)
mkdirSync(target, { recursive: true })
for (const file of ['package.json', 'package-lock.json']) cpSync(path.join(repo, file), path.join(target, file))
const excluded = new Set(['node_modules', 'dist', '.git', '.figma', 'test-results', 'test-results-real', 'test-results-planning', 'playwright-report', 'generated'])
const filter = file => !file.split(path.sep).some(part => excluded.has(part))
  && (!path.basename(file).startsWith('.env') || path.basename(file) === '.env.example')
for (const folder of ['clients/cli', 'clients/desktop', 'clients/web-raptix', 'clients/shared']) {
  cpSync(path.join(repo, folder), path.join(target, folder), { recursive: true, filter })
}
if (existsSync(path.join(target, 'clients/web'))) throw new Error('Legacy folder unexpectedly included')
const manifest = JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8'))
if (manifest.workspaces.includes('clients/*') || manifest.workspaces.includes('clients/web')) throw new Error('Legacy remains in active workspaces')
const steps = [
  ['ci', '--no-audit', '--no-fund', '--prefer-offline'],
  ['run', 'build', '--workspace=@raptix/streaming'],
  ['run', 'build', '--workspace=@raptix/web-contracts'],
  ...(phase !== 'w01' ? [['run', 'prisma:generate', '--workspace=@raptix/web-raptix-server']] : []),
  ['run', 'typecheck', '--workspace=@raptix/web-raptix-server'],
  ['run', 'test', '--workspace=@raptix/web-raptix-server'],
  ['run', 'build', '--workspace=@raptix/web-raptix-server'],
  ['run', 'build', '--workspace=@raptix/web-raptix'],
]
const results = []
for (const args of steps) {
  const command = ['npm', ...args].join(' ')
  const result = spawnSync(process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d', '/c', command] : args, { cwd: target, stdio: 'inherit', timeout: 240000 })
  results.push({ command, exitCode: result.status })
  if (result.status !== 0) {
    writeFileSync(path.join(repo, `clients/web-raptix/docs/integration/${phase}-independence.json`), JSON.stringify({ target, legacyOmitted: true, ok: false, results }, null, 2) + '\n')
    throw new Error(`Independence gate failed: ${command}`)
  }
}
writeFileSync(path.join(repo, `clients/web-raptix/docs/integration/${phase}-independence.json`), JSON.stringify({ target, legacyOmitted: true, ok: true, results }, null, 2) + '\n')
console.log(`${phase} clean install/build gate passed without clients/web: ${target}`)
