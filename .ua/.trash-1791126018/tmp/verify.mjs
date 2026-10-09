import { readFileSync } from 'node:fs';
const ROOT = 'D:/.VTNet/redteam/raptix';
const UA = ROOT + '/.ua';
const batches = JSON.parse(readFileSync(UA + '/intermediate/batches.json', 'utf-8'));
let fail = 0;
const ok = (cond, msg) => { if (!cond) { console.log('FAIL: ' + msg); fail++; } };
let totN = 0, totE = 0;
for (const idx of [111, 112, 113, 114, 115]) {
  const b = JSON.parse(readFileSync(`${UA}/intermediate/batch-${idx}.json`, 'utf-8'));
  const src = batches.batches.find((x) => x.batchIndex === idx);
  totN += b.nodes.length; totE += b.edges.length;

  // 1. batchFiles verbatim (4 fields, order-sensitive values)
  ok(b.batchFiles.length === src.files.length, `${idx}: file count ${b.batchFiles.length} != ${src.files.length}`);
  ok(b.batchIndex === idx, `${idx}: batchIndex mismatch`);
  for (let i = 0; i < b.batchFiles.length; i++) {
    const a = b.batchFiles[i], s = src.files[i];
    ok(a.path === s.path && a.language === s.language && a.sizeLines === s.sizeLines && a.fileCategory === s.fileCategory,
      `${idx}: batchFiles[${i}] mismatch: ${JSON.stringify(a)} vs ${JSON.stringify(s)}`);
    ok(Object.keys(a).length === 4, `${idx}: batchFiles[${i}] has ${Object.keys(a).length} fields, expected 4`);
  }

  // 2. node id/type conventions
  const ids = new Set();
  for (const n of b.nodes) {
    ok(n.id.startsWith('document:') || n.id.startsWith('config:') || n.id.startsWith('file:') || n.id.startsWith('service:'),
      `${idx}: bad id prefix ${n.id}`);
    ok(!n.id.includes('raptix:') && !n.id.startsWith('file:raptix/'), `${idx}: project-prefixed id ${n.id}`);
    ok((n.id.match(/:/g) || []).length === 1, `${idx}: id has extra colon ${n.id}`);
    const expectedType = n.filePath.endsWith('.md') ? 'document' : 'config';
    ok(n.type === expectedType, `${idx}: type ${n.type} != ${expectedType} for ${n.filePath}`);
    ok(n.id === `${n.type}:${n.filePath}`, `${idx}: id/path mismatch ${n.id}`);
    ok(Array.isArray(n.lineRange) && n.lineRange[0] === 1, `${idx}: bad lineRange ${JSON.stringify(n.lineRange)}`);
    ok(n.tags.length >= 3 && n.tags.length <= 5, `${idx}: tag count ${n.tags.length} for ${n.id}`);
    ok(['simple', 'moderate', 'complex'].includes(n.complexity), `${idx}: bad complexity ${n.complexity}`);
    ok(typeof n.summary === 'string' && n.summary.length > 40, `${idx}: thin summary ${n.id}`);
    ids.add(n.id);
  }

  // 3. edges: no self-edges, valid endpoints or known cross-batch producer
  const known = new Set(['file:benchmark/reporter.py']);
  for (const e of b.edges) {
    ok(e.source !== e.target, `${idx}: self-edge ${e.source}`);
    ok(ids.has(e.source) || known.has(e.source), `${idx}: unknown source ${e.source}`);
    ok(ids.has(e.target) || known.has(e.target), `${idx}: unknown target ${e.target}`);
    ok(typeof e.weight === 'number' && e.direction === 'forward', `${idx}: bad edge meta ${e.source}->${e.target}`);
  }

  // 4. imports edges 1:1 with batchImportData
  let expect = 0;
  for (const v of Object.values(src.batchImportData)) expect += v.length;
  const got = b.edges.filter((e) => e.type === 'imports').length;
  ok(expect === got, `${idx}: imports edges ${got} != batchImportData total ${expect}`);
  const impKeys = Object.keys(src.batchImportData);
  ok(impKeys.length === src.files.length, `${idx}: importData keys ${impKeys.length} != files ${src.files.length}`);

  // 5. UTF-8 sanity: read raw bytes, ensure Vietnamese chars survive a round trip
  const raw = readFileSync(`${UA}/intermediate/batch-${idx}.json`, 'utf-8');
  ok(raw.includes('benchmark') && !raw.includes('\uFFFD'), `${idx}: encoding artifacts`);
  ok(JSON.parse(raw).batchIndex === idx, `${idx}: re-parse failed`);
  console.log(`batch-${idx}: OK nodes=${b.nodes.length} edges=${b.edges.length}`);
}
console.log(`TOTAL nodes=${totN} edges=${totE} failures=${fail}`);
