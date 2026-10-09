const fs = require('fs');
const UA = 'D:/.VTNet/redteam/raptix/.ua';
const b = require(`${UA}/intermediate/batches.json`);

// merged node id set from all batch files 1..95 + 116..120
const merged = new Set();
for (let i = 1; i <= 95; i++) {
  const x = require(`${UA}/intermediate/batch-${i}.json`);
  for (const n of x.nodes) merged.add(n.id);
}
const mine = {};
for (const i of [116, 117, 118, 119, 120]) {
  mine[i] = JSON.parse(fs.readFileSync(`${UA}/intermediate/batch-${i}.json`, 'utf8'));
  for (const n of mine[i].nodes) merged.add(n.id);
}

const FILE_LEVEL = new Set(['file', 'config', 'document', 'service', 'pipeline', 'table', 'schema', 'resource', 'endpoint']);
let totalNodes = 0, totalEdges = 0;
const problems = [];

for (const i of [116, 117, 118, 119, 120]) {
  const x = mine[i];
  const src = b.batches.find(y => y.batchIndex === i);
  totalNodes += x.nodes.length;
  totalEdges += x.edges.length;

  // 1. batchFiles verbatim
  if (JSON.stringify(x.batchFiles) !== JSON.stringify(src.files)) problems.push(`${i}: batchFiles not verbatim`);
  if (x.batchIndex !== i) problems.push(`${i}: batchIndex mismatch`);

  const ids = new Set(x.nodes.map(n => n.id));
  const dup = x.nodes.length !== ids.size;
  if (dup) problems.push(`${i}: duplicate node IDs in batch`);

  for (const n of x.nodes) {
    const pfx = n.id.split(':')[0];
    if (!FILE_LEVEL.has(pfx) && !['function', 'class'].includes(pfx)) problems.push(`${i}: bad prefix ${n.id}`);
    if (!n.summary || !n.tags || !n.tags.length || !n.complexity) problems.push(`${i}: node missing fields ${n.id}`);
    if (n.tags && (n.tags.length < 3 || n.tags.length > 5)) problems.push(`${i}: tags count ${n.tags.length} ${n.id}`);
    if (!['simple', 'moderate', 'complex'].includes(n.complexity)) problems.push(`${i}: bad complexity ${n.id}`);
    // no project-name prefix / bare path
    if (n.id.startsWith('raptix') || n.id.startsWith('Raptix:')) problems.push(`${i}: project prefix ${n.id}`);
    const pathPart = n.filePath || '';
    if (pathPart.startsWith('/') || pathPart.startsWith('D:')) problems.push(`${i}: absolute path ${n.id}`);
  }
  // name check: file-level name should be basename
  for (const n of x.nodes) {
    if (FILE_LEVEL.has(n.type) && n.name && n.name.includes('/')) problems.push(`${i}: name contains path ${n.id}`);
  }

  for (const e of x.edges) {
    if (!merged.has(e.source)) problems.push(`${i}: source missing in merged set ${e.source}`);
    if (!merged.has(e.target)) problems.push(`${i}: target missing in merged set ${e.target}`);
    if (e.source === e.target) problems.push(`${i}: self-edge ${e.source}`);
    if (!e.direction || e.weight == null) problems.push(`${i}: edge missing direction/weight ${e.source}->${e.target}`);
  }

  // imports 1:1 batchImportData
  const expected = [];
  for (const [p, imps] of Object.entries(src.batchImportData)) {
    for (const t of imps) expected.push([p, t]);
  }
  const got = x.edges.filter(e => e.type === 'imports').map(e => [
    e.source.replace(/^file:/, ''), e.target.replace(/^file:/, ''),
  ]);
  const expKey = expected.map(([a, bb]) => a + '=>' + bb).sort().join('|');
  const gotKey = got.map(([a, bb]) => a + '=>' + bb).sort().join('|');
  if (expKey !== gotKey) problems.push(`${i}: imports mismatch\n  expected: ${expKey}\n  got: ${gotKey}`);

  const orphan = x.nodes.filter(n => FILE_LEVEL.has(n.type) && !x.edges.some(e => e.source === n.id || e.target === n.id));
  for (const o of orphan) problems.push(`${i}: orphan file-level node ${o.id}`);

  console.log(`batch ${i}: nodes=${x.nodes.length} edges=${x.edges.length}`);
}

console.log('TOTAL nodes:', totalNodes, 'edges:', totalEdges);
console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'ALL CHECKS PASSED');
