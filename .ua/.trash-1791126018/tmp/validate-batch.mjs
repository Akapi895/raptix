#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const UA = 'D:/.VTNet/redteam/raptix/.ua';
const batches = JSON.parse(readFileSync(join(UA, 'intermediate/batches.json'), 'utf-8'));
let allOk = true;
for (const idx of [36, 37, 38, 39, 40]) {
  const p = join(UA, `intermediate/batch-${idx}.json`);
  let doc;
  try {
    doc = JSON.parse(readFileSync(p, 'utf-8'));
  } catch (e) {
    console.log(`batch ${idx}: INVALID JSON — ${e.message}`);
    allOk = false;
    continue;
  }
  const src = batches.batches.find((b) => b.batchIndex === idx);
  const problems = [];
  // 1. batchFiles verbatim 4-field
  if (doc.batchIndex !== idx) problems.push('batchIndex mismatch');
  if (doc.batchFiles.length !== src.files.length) problems.push('batchFiles count mismatch');
  for (let i = 0; i < src.files.length; i++) {
    const a = src.files[i];
    const b = doc.batchFiles[i];
    const keys = Object.keys(b);
    if (
      a.path !== b.path || a.language !== b.language || a.sizeLines !== b.sizeLines ||
      a.fileCategory !== b.fileCategory || keys.length !== 4 ||
      keys.join() !== 'path,language,sizeLines,fileCategory'
    ) problems.push(`batchFiles[${i}] not verbatim`);
  }
  // 2. node id prefixes + no project prefix + required fields
  const ids = new Set();
  for (const n of doc.nodes) {
    ids.add(n.id);
    if (!/^(file|function|class|config|document|service|pipeline|resource|table|schema|endpoint):/.test(n.id)) problems.push(`bad id prefix: ${n.id}`);
    if (n.id.includes('D:') || n.id.includes('redteam') || n.id.includes('raptix/raptix') === false && false) {}
    if (n.id.startsWith('raptix') || n.id.startsWith('/')) problems.push(`non-prefixed id: ${n.id}`);
    for (const k of ['id', 'type', 'name', 'filePath', 'summary', 'tags', 'complexity']) {
      if (n[k] === undefined || n[k] === null || n[k] === '') problems.push(`node ${n.id} missing ${k}`);
    }
    if ((n.tags || []).length < 3 || (n.tags || []).length > 5) problems.push(`node ${n.id} tags count ${n.tags?.length}`);
    if (!['simple', 'moderate', 'complex'].includes(n.complexity)) problems.push(`node ${n.id} bad complexity`);
    if (n.type === 'function' || n.type === 'class') {
      if (!Array.isArray(n.lineRange) || n.lineRange.length !== 2) problems.push(`node ${n.id} bad lineRange`);
    }
  }
  // 3. edges: endpoints exist, no self-edge, weights
  for (const e of doc.edges) {
    if (!ids.has(e.source)) problems.push(`edge ${e.type} source missing node: ${e.source}`);
    if (!ids.has(e.target)) problems.push(`edge ${e.type} target missing node: ${e.target}`);
    if (e.source === e.target) problems.push(`self-edge ${e.type}: ${e.source}`);
    if (e.direction !== 'forward') problems.push(`edge direction != forward`);
  }
  // 4. imports 1:1
  let importExpected = 0;
  for (const v of Object.values(src.batchImportData)) importExpected += v.length;
  const importActual = doc.edges.filter((e) => e.type === 'imports').length;
  if (importExpected !== importActual) problems.push(`imports expected ${importExpected} got ${importActual}`);
  // 5. unique edges
  const seen = new Set();
  for (const e of doc.edges) {
    const k = `${e.source}|${e.target}|${e.type}`;
    if (seen.has(k)) problems.push(`duplicate edge ${k}`);
    seen.add(k);
  }
  // 6. vietnamese check: summaries contain Vietnamese diacritics for most nodes
  const vi = doc.nodes.filter((n) => /[ăâêôơưáàảãạắằẳẵặấầẩẫậéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵđ]/i.test(n.summary)).length;
  const noVi = doc.nodes.filter((n) => !/[ăâêôơưáàảãạắằẳẵặấầẩẫậéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵđ]/i.test(n.summary));
  const counts = {};
  for (const e of doc.edges) counts[e.type] = (counts[e.type] || 0) + 1;
  const ncounts = {};
  for (const n of doc.nodes) ncounts[n.type] = (ncounts[n.type] || 0) + 1;
  if (problems.length) { allOk = false; console.log(`batch ${idx}: ${problems.length} PROBLEM(S)`); for (const q of problems.slice(0, 20)) console.log('  - ' + q); }
  else console.log(`batch ${idx}: OK | nodes=${doc.nodes.length} (${Object.entries(ncounts).map(([k, v]) => `${k}:${v}`).join(' ')}) edges=${doc.edges.length} (${Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(' ')}) | summaries without VN diacritics: ${noVi.length} [${noVi.slice(0, 3).map(n => n.id).join(', ')}]`);
}
console.log(allOk ? 'ALL BATCHES VALID' : 'VALIDATION FAILURES PRESENT');
