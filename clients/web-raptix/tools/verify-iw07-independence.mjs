import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('../../../', import.meta.url))
const suffix = Date.now().toString()
const target = path.join(tmpdir(), 'opencode', `raptix-iw07-independent-${suffix}`)
const evidence = path.join(repo, 'clients/web-raptix/test-results-deployed/iw07')
mkdirSync(target, {recursive:true})
mkdirSync(evidence, {recursive:true})
const excluded = new Set(['node_modules','dist','.git','.figma','playwright-report','generated'])
const filter = file => !file.split(path.sep).some(p => excluded.has(p) || p.startsWith('test-results')) && (!path.basename(file).startsWith('.env') || path.basename(file)==='.env.example')
for (const file of ['package.json','package-lock.json','.dockerignore']) cpSync(path.join(repo,file),path.join(target,file))
for (const dir of ['clients/cli','clients/desktop','clients/web-raptix','clients/shared']) cpSync(path.join(repo,dir),path.join(target,dir),{recursive:true,filter})
mkdirSync(path.join(target,'containers'),{recursive:true})
for (const file of ['web-raptix.Dockerfile','web-raptix-server.Dockerfile','web-raptix-proxy.conf']) cpSync(path.join(repo,'containers',file),path.join(target,'containers',file))
const env={...process.env}
for(const key of ['DATABASE_URL','WORKSPACE_PATH','LANGGRAPH_API_URL','VAULT_ENCRYPTION_KEY']) delete env[key]
const results=[]
const report={target,legacyOmitted:true,results,images:{ui:`raptix-web-raptix-ui:iw07-${suffix}`,api:`raptix-web-raptix-api:iw07-${suffix}`}}
function run(command,args){
  if(existsSync(path.join(target,'clients/web')))throw Error('Legacy folder present in independence target')
  const npm=command==='npm'&&process.platform==='win32'
  const result=spawnSync(npm?'cmd.exe':command,npm?['/d','/c',['npm',...args].join(' ')]:args,{cwd:target,env,stdio:'inherit',timeout:600000})
  results.push({command:[command,...args].join(' '),exitCode:result.status})
  writeFileSync(path.join(evidence,'independence.json'),JSON.stringify(report,null,2))
  if(result.status!==0)throw Error(`Independence command failed: ${command} ${args.join(' ')}`)
}
run('npm',['ci','--no-audit','--no-fund'])
for(const workspace of ['@raptix/streaming','@raptix/web-contracts'])run('npm',['run','build',`--workspace=${workspace}`])
run('npm',['run','prisma:generate','--workspace=@raptix/web-raptix-server'])
for(const workspace of ['@raptix/web-raptix-server','@raptix/web-raptix'])for(const script of ['typecheck','lint','build','test'])run('npm',['run',script,`--workspace=${workspace}`,...(script==='test'&&workspace.endsWith('-server')?['--','--maxWorkers=1']:[])])
run('npm',['run','test:e2e','--workspace=@raptix/web-raptix'])
run('docker',['build','-f','containers/web-raptix.Dockerfile','--build-arg','VERSION=0.0.0-iw07','-t',report.images.ui,'.'])
run('docker',['build','-f','containers/web-raptix-server.Dockerfile','--build-arg','VERSION=0.0.0-iw07','-t',report.images.api,'.'])
env.IW07_UI_IMAGE=report.images.ui
env.IW07_API_IMAGE=report.images.api
env.IW07_EVIDENCE_DIR=evidence
run('node',['clients/web-raptix/tools/verify-iw07-live.mjs'])
report.ok=true
writeFileSync(path.join(evidence,'independence.json'),JSON.stringify(report,null,2))
console.log('PASS IW07 clean install/build/tests/Docker/live without clients/web:',target)
