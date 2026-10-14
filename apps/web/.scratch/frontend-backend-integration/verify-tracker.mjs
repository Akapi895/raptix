// Source/contract checks for integration tickets 01-02; no application services are started.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const tracker = dirname(fileURLToPath(import.meta.url))
const root = resolve(tracker, '../../../..')
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
const registry = readFileSync(resolve(root, 'apps/web/src/router/registry.tsx'), 'utf8')
const oldRegistry = git('show', '2c88117:apps/web-improve/src/router/registry.tsx')
const manifestKeys = text => Array.from(text.split('const MANIFEST:')[1].split('setKnownPages')[0].matchAll(/(?:'([^']+)'|([\w-]+)):\s*'[a-z]'/g), match => match[1] ?? match[2]).sort()
assert.deepEqual(manifestKeys(registry), manifestKeys(oldRegistry))
assert.equal(manifestKeys(registry).length, 53)
console.log('PASS: all 53 route keys retained from 2c88117')
assert.equal(git('diff', '--name-only', 'HEAD', '--', 'apps/web/server'), '')
console.log('PASS: server sources, migrations and tests unchanged from HEAD')

const docs = ['spec.md', 'coverage.md', 'execution.md', ...readdirSync(resolve(tracker, 'issues')).map(name => `issues/${name}`)]
let failures = 0
for (const name of docs) {
  const path = resolve(tracker, name)
  const text = readFileSync(path, 'utf8')
  for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0]
    if (!target || /^[a-z]+:\/\//.test(target)) continue
    if (!existsSync(resolve(dirname(path), target))) { failures++; console.error(`FAIL: ${name} links to missing ${target}`) }
  }
}
console.log(`${failures ? 'FAIL' : 'PASS'}: tracker Markdown links (${failures} missing)`)
for (const name of ['0068-web-frontend-real-mode-data-boundary.md', '0069-web-workflow-lifecycle-storage.md']) {
  const text = readFileSync(resolve(root, 'docs/adr', name), 'utf8')
  const related = text.match(/\*\*Related:\*\* (\S+)/)?.[1]
  if (related && !existsSync(resolve(root, related))) {
    failures++; console.error(`FAIL: ADR ${name} references missing ${related}`)
  }
}
const packageJson = JSON.parse(readFileSync(resolve(root, 'apps/web/package.json'), 'utf8'))
const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'))
assert.equal(packageJson.name, '@raptix/web-raptix')
assert.deepEqual(lock.packages['apps/web'].dependencies, packageJson.dependencies)
assert.deepEqual(lock.packages['apps/web'].devDependencies, packageJson.devDependencies)
console.log('PASS: canonical UI workspace manifest matches root lockfile')
process.exitCode = failures ? 1 : 0
