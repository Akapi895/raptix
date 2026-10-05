import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {randomBytes,randomUUID} from 'node:crypto'
import {mkdirSync,writeFileSync,existsSync} from 'node:fs'
import {resolve} from 'node:path'
import {chromium} from 'playwright'

assert.ok(!existsSync('clients/web'),'Run this gate inside the independent snapshot')
const output=resolve(process.env.IW07_EVIDENCE_DIR??'apps/web/test-results-deployed/iw07')
mkdirSync(output,{recursive:true})
const suffix=randomUUID().slice(0,8), network=`raptix-iw07-${suffix}`
const docker=args=>execFileSync('docker',args,{encoding:'utf8',timeout:180000}).trim()
const containers=[],checks=[]
let browser,page,threadId,base,engagement
const check=(name,ok)=>{checks.push({name,ok});console.log(ok?'PASS':'FAIL',name);assert.ok(ok,name)}
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const wait=async fn=>{const until=Date.now()+300000;while(Date.now()<until){const value=await fn();if(value)return value;await sleep(2000)}throw Error('Live independence deadline exceeded')}
docker(['network','create',network])
try{
  const pg=`${network}-postgres`,password=randomBytes(18).toString('hex')
  docker(['run','-d','--name',pg,'--network',network,'--network-alias',pg,'-e','POSTGRES_USER=raptix','-e','POSTGRES_DB=raptix_web_raptix','-e',`POSTGRES_PASSWORD=${password}`,'postgres:17-alpine'])
  containers.push(pg)
  await wait(async()=>{try{return docker(['exec',pg,'pg_isready','-U','raptix','-d','raptix_web_raptix']).includes('accepting connections')}catch{return false}})
  const api=`${network}-api`
  const apiImage=process.env.IW07_API_IMAGE,uiImage=process.env.IW07_UI_IMAGE
  for(const image of [apiImage,uiImage])check('Image version label matches snapshot',docker(['image','inspect',image,'--format','{{ index .Config.Labels "org.opencontainers.image.version" }}'])==='0.0.0-iw07')
  docker(['run','-d','--name',api,'--network',network,'--network-alias','web-raptix-api','-v',`${process.env.IW07_WORKSPACE_VOLUME??'raptix_workspace_data'}:/workspace`,'-e','HOST=0.0.0.0','-e','PORT=8081','-e',`DATABASE_URL=postgresql://raptix:${password}@${pg}:5432/raptix_web_raptix`,'-e','WORKSPACE_PATH=/workspace','-e','RAPTIX_RUNTIME_WORKSPACE_ROOT=/workspace','-e',`LANGGRAPH_API_URL=http://${process.env.IW07_RUNTIME_HOST??'raptix-langgraph'}:2024`,apiImage])
  containers.push(api)
  docker(['network','connect',process.env.IW07_RUNTIME_NETWORK??'raptix_raptix-net',api])
  const ui=`${network}-ui`
  docker(['run','-d','--name',ui,'--network',network,'-p','127.0.0.1::8080',uiImage])
  containers.push(ui)
  base='http://127.0.0.1:'+docker(['port',ui,'8080/tcp']).match(/:(\d+)$/)[1]
  await wait(async()=>{try{return(await fetch(base+'/api/health')).ok}catch{return false}})
  const ready=await wait(async()=>{const r=await fetch(base+'/api/health/ready');return r.ok?r.json():null})
  check('Real DB and runtime catalog connected',ready.scope==='dependency_wiring')
  check('Health does not claim inference/tool execution',ready.notProbed.includes('model_inference'))
  browser=await chromium.launch({channel:'chromium'})
  page=await browser.newPage()
  await page.goto(base+'/projects')
  const slug=`iw07-live-${Date.now()}`
  await page.getByRole('button',{name:'New Project',exact:true}).click()
  await page.locator('#real-new-project-display-name').fill(slug)
  await page.locator('#real-new-project-slug').fill(slug)
  await page.locator('#real-new-project-target').fill('http://iw07-authorized.invalid')
  await page.locator('#real-new-project-auth').check()
  const created=page.waitForResponse(r=>r.url().endsWith('/api/engagements')&&r.request().method()==='POST')
  await page.getByRole('button',{name:'Create Project',exact:true}).click()
  const response=await created
  check('Project created by UI in isolated PostgreSQL',response.status()===201)
  engagement=(await response.json()).id
  await page.waitForURL(`**/projects/${engagement}/charter`)
  await page.reload()
  await page.getByRole('heading',{name:`${slug} — Charter & Rules of Engagement`}).waitFor()
  check('Reload persists new-API data',true)
  check('No fixture identity',(await page.getByText('Alex Kim',{exact:true}).count())===0)
  await page.getByRole('button',{name:'Operator Console',exact:true}).click()
  await page.getByRole('button',{name:'New planning chat',exact:true}).click()
  await page.waitForFunction(()=>Boolean(document.querySelector('select[aria-label="Bound thread"]')?.value),undefined,{timeout:60000})
  threadId=await page.getByRole('combobox',{name:'Bound thread'}).inputValue()
  await page.getByPlaceholder('Send a root message to the bound assistant…').fill('IW07 isolated integration check: acknowledge only. Do not invoke tools, delegate, write files, or access targets.')
  await page.getByRole('button',{name:'Send',exact:true}).click()
  await page.getByText('RUN SUCCESS',{exact:true}).waitFor({timeout:300000})
  check('Actual LangGraph planning run succeeds',true)
  await page.reload()
  await page.getByText('HISTORY',{exact:true}).first().waitFor({timeout:60000})
  check('Runtime history recovers after reload',true)
  await page.screenshot({path:resolve(output,'independent-live-console.png'),fullPage:true})
  const legacy=execFileSync('docker',['ps','--filter','name=^/raptix-web$','--format','{{.Names}}'],{encoding:'utf8'}).trim()
  check('Legacy web service is not running',legacy==='')
}finally{
  if(threadId&&containers.some(c=>c.endsWith('-api'))){
    try{docker(['exec',`${network}-api`,'node','-e',`fetch('http://raptix-langgraph:2024/threads/${threadId}',{method:'DELETE'}).then(r=>{if(!r.ok)process.exit(1)})`])}catch(error){console.error('Test-thread cleanup:',error.message)}
  }
  if(browser)await browser.close()
  writeFileSync(resolve(output,'live.json'),JSON.stringify({engagement,threadId,legacyAbsent:true,checks},null,2))
  for(const name of containers.reverse())docker(['rm','-f',name])
  docker(['network','rm',network])
}
