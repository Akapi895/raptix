// Capture exact source inputs, including uncommitted files, without collecting .env/secrets.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const output = resolve(root, process.argv[2] ?? 'tests/local/artifacts/operational-m1/release.json')
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
const paths = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--',
  'apps/web', 'apps/shared', 'packages', 'plugins', 'infra/containers',
  'docker-compose.web-raptix.yml', 'docker-compose.web-runtime.yml',
  'pyproject.toml', 'uv.lock', 'langgraph.json', 'package.json', 'package-lock.json',
]).split('\0').filter(Boolean)
const sources = Object.fromEntries([...new Set(paths)].sort().map(path => [path, createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex')]))
const head = git(['rev-parse', 'HEAD'])
const sourceDigest = createHash('sha256').update(JSON.stringify(sources)).digest('hex')
const revision = `${head.slice(0, 12)}-tree-${sourceDigest.slice(0, 16)}`

// Optionally stamp the deployed images so the manifest binds code to the built artifact.
const images = []
for (const reference of (process.env.M1_RELEASE_IMAGES ?? '').split(',').map(value => value.trim()).filter(Boolean)) {
  try {
    const [inspect] = JSON.parse(execFileSync('docker', ['image', 'inspect', reference], { encoding: 'utf8', timeout: 15000 }))
    images.push({ reference, id: inspect.Id, revisionLabel: inspect.Config?.Labels?.['org.opencontainers.image.revision'] ?? null })
  } catch { images.push({ reference, id: null, revisionLabel: null, error: 'image not present locally' }) }
}

mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, JSON.stringify({ head, sourceDigest, revision, capturedAt: new Date().toISOString(), images, sources }, null, 2))
console.log(revision)
