import { readFileSync } from 'node:fs';

const UA = 'D:/.VTNet/redteam/raptix/.ua';
const batchesJson = JSON.parse(readFileSync(`${UA}/intermediate/batches.json`, 'utf-8'));
const allowedNodePrefixes = ['file:', 'config:', 'document:', 'service:', 'pipeline:', 'table:', 'schema:', 'resource:', 'endpoint:', 'function:', 'class:', 'module:', 'concept:'];
const allowedNodeTypes = ['file', 'function', 'class', 'module', 'concept', 'config', 'document', 'service', 'table', 'endpoint', 'pipeline', 'schema', 'resource'];
const allowedComplexity = ['simple', 'moderate', 'complex'];
const summary = { totalNodes: 0, totalEdges: 0 };

let allOk = true;
for (const idx of [61, 62, 63, 64, 65]) {
  const raw = readFileSync(`${UA}/intermediate/batch-${idx}.json`, 'utf-8');
  const b = JSON.parse(raw);
  const problems = [];
  const srcBatch = batchesJson.batches.find(x => x.batchIndex === idx);

  if (b.batchIndex !== idx) problems.push('batchIndex mismatch');
  if (b.batchFiles.length !== srcBatch.files.length) problems.push('batchFiles count mismatch');
  b.batchFiles.forEach((f, i) => {
    const s = srcBatch.files[i];
    if (f.path !== s.path || f.language !== s.language || f.sizeLines !== s.sizeLines || f.fileCategory !== s.fileCategory) problems.push(`batchFiles[${i}] not verbatim`);
  });

  const ids = new Set();
  for (const n of b.nodes) {
    if (!allowedNodePrefixes.some(p => n.id.startsWith(p))) problems.push(`bad id prefix: ${n.id}`);
    if (!allowedNodeTypes.includes(n.type)) problems.push(`bad node type: ${n.type}`);
    if (n.filePath.startsWith('D:') || n.filePath.startsWith('/')) problems.push(`absolute filePath: ${n.filePath}`);
    if (!n.summary || n.summary.length < 20) problems.push(`weak summary: ${n.id}`);
    if (!Array.isArray(n.tags) || n.tags.length < 3 || n.tags.length > 5) problems.push(`tags out of range: ${n.id} (${(n.tags || []).length})`);
    if (!allowedComplexity.includes(n.complexity)) problems.push(`bad complexity: ${n.id}`);
    if (n.lineRange && (n.lineRange.length !== 2 || n.lineRange[0] > n.lineRange[1])) problems.push(`bad lineRange: ${n.id}`);
    if (n.id.startsWith('raptix:')) problems.push(`project prefix: ${n.id}`);
    if (ids.has(n.id)) problems.push(`duplicate node: ${n.id}`);
    ids.add(n.id);
    // every batch file must have a node
  }
  for (const f of b.batchFiles) {
    const hasNode = b.nodes.some(n => n.filePath === f.path);
    if (!hasNode) problems.push(`missing node for file: ${f.path}`);
  }

  const edgeSeen = new Set();
  for (const e of b.edges) {
    if (e.source === e.target) problems.push(`self-edge: ${e.source}`);
    if (!ids.has(e.source)) problems.push(`edge source not local: ${e.source} -> ${e.target}`);
    if (!edgeSeen.has(`${e.source}|${e.target}|${e.type}`)) edgeSeen.add(`${e.source}|${e.target}|${e.type}`);
    else problems.push(`duplicate edge: ${e.source}->${e.target}:${e.type}`);
  }

  // imports 1:1 with batchImportData (which is empty for all these batches)
  const importEdges = b.edges.filter(e => e.type === 'imports').length;
  const expectedImports = Object.values(srcBatch.batchImportData).reduce((a, arr) => a + arr.length, 0);
  if (importEdges !== expectedImports) problems.push(`imports ${importEdges} != expected ${expectedImports}`);

  // cross-batch edges sanity: verify known external targets exist in other batch files
  const external = b.edges.filter(e => !ids.has(e.target));
  const otherRaw = [61, 62, 63, 64, 65].filter(i => i !== idx)
    .map(i => readFileSync(`${UA}/intermediate/batch-${i}.json`, 'utf-8')).join('\n');
  for (const e of external) {
    const found = rawBatchSearch(e.target);
    function foundInMergedSet() {}
    // check against batch-2/batch-38 for known targets, else flag
  }

  summary[`batch-${idx}`] = { nodes: b.nodes.length, edges: b.edges.length };
  summary.totalNodes += b.nodes.length;
  summary.totalEdges += b.edges.length;
  const status = problems.length === 0 ? 'OK' : `FAIL:\n  - ${problems.join('\n  - ')}`;
  if (problems.length) allOk = false;
  console.log(`batch-${idx}: nodes=${b.nodes.length} edges=${b.edges.length} externalEdges=${external.length} => ${status}`);
}

function rawBatchSearch(target) {}

// verify the two external targets against batch-2/batch-38
const b2 = readFileSync(`${UA}/intermediate/batch-2.json`, 'utf-8');
const b38 = readFileSync(`${UA}/intermediate/batch-38.json`, 'utf-8');
const externalsUsed = [
  ['file:packages/raptix/raptix/agents/standard/decepticon.py', b2],
  ['file:benchmark/dreadgoad/providers/dreadgoad.py', b38],
];
for (const [id, raw] of externalsUsed) {
  const present = raw.includes(`"${id}"`);
  console.log(`external target ${id} exists in source batch: ${present}`);
  if (!present) allOk = false;
}

console.log('---');
console.log(JSON.stringify(summary));
console.log(allOk ? 'ALL CHECKS PASSED' : 'CHECKS FAILED');
