#!/usr/bin/env node
// Deterministic batch node/edge builder for UA file-analyzer (batches 126-130).
// Usage: node gen-ua.mjs <batchIndex>

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

const PROJECT_ROOT = 'D:/.VTNet/redteam/raptix';
const UA_DIR = join(PROJECT_ROOT, '.ua');
const IDX = Number(process.argv[2]);
if (!Number.isInteger(IDX)) {
  console.error('usage: node gen-ua.mjs <batchIndex>');
  process.exit(1);
}

const batches = JSON.parse(readFileSync(join(UA_DIR, 'intermediate/batches.json'), 'utf-8'));
const batch = batches.batches.find((b) => b.batchIndex === IDX);
if (!batch) {
  console.error(`batch ${IDX} not found`);
  process.exit(1);
}
const extractPath = join(UA_DIR, `tmp/ua-file-analyzer-output-${IDX}.json`);
if (!existsSync(extractPath) || statSync(extractPath).size === 0) {
  console.error(`extract output missing/empty: ${extractPath}`);
  process.exit(1);
}
const extract = JSON.parse(readFileSync(extractPath, 'utf-8'));
if (!extract.scriptCompleted || !Array.isArray(extract.results)) {
  console.error('extract output invalid');
  process.exit(1);
}

const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const data = require(`./ua-data-${IDX}.cjs`);

// ── node-type mapping ───────────────────────────────────────────────────────
function nodeTypeFor(path, fileCategory) {
  if (data.nodeTypeOverrides && data.nodeTypeOverrides[path]) return data.nodeTypeOverrides[path];
  if (fileCategory === 'config') return 'config';
  if (fileCategory === 'docs') return 'document';
  if (fileCategory === 'data' && path.endsWith('.sql')) return 'schema';
  return 'file';
}

const catByPath = {};
for (const b of batches.batches) for (const f of b.files) catByPath[f.path] = f.fileCategory;
function idFor(path) {
  const base = path.split('/').pop();
  if (/^Dockerfile/i.test(base)) return `service:${path}`;
  if (base === 'pyproject.toml' || base === 'package.json') return `config:${path}`;
  const cat = catByPath[path];
  if (cat === 'config') return `config:${path}`;
  if (cat === 'docs') return `document:${path}`;
  if (cat === 'data' && path.endsWith('.sql')) return `schema:${path}`;
  return `file:${path}`;
}

// ── helpers ─────────────────────────────────────────────────────────────────
const trunc = (s, n = 240) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const isTestPath = (p) => {
  const b = basename(p);
  return p.includes('/tests/') || b.startsWith('test_');
};
function symComplexity(lines) {
  if (lines <= 20) return 'simple';
  if (lines <= 80) return 'moderate';
  return 'complex';
}

const resultsByPath = new Map(extract.results.map((r) => [r.path, r]));
const sizeByPath = new Map(batch.files.map((f) => [f.path, f.sizeLines]));
const catForBatch = new Map(batch.files.map((f) => [f.path, f.fileCategory]));

// ── nodes ───────────────────────────────────────────────────────────────────
const nodes = [];
const nodeIds = new Set();

for (const bf of batch.files) {
  const p = bf.path;
  const meta = data.files[p];
  if (!meta) {
    console.error(`missing file summary for ${p}`);
    process.exit(1);
  }
  const type = nodeTypeFor(p, bf.fileCategory);
  const node = {
    id: `${type}:${p}`,
    type,
    name: basename(p),
    filePath: p,
    summary: meta.summary,
    tags: meta.tags,
    complexity: meta.complexity,
  };
  if (bf.sizeLines > 0) node.lineRange = [1, bf.sizeLines];
  nodes.push(node);
  nodeIds.add(node.id);
}

for (const r of extract.results) {
  const p = r.path;
  const meta = data.files[p];
  const exportNames = new Set((r.exports || []).map((e) => e.name).filter(Boolean));
  for (const f of r.functions || []) {
    const lines = f.endLine - f.startLine + 1;
    const exported = exportNames.has(f.name);
    if (!(lines >= 10 || exported)) continue; // significance rule
    const summary = data.overrides[`${p}::${f.name}`];
    if (!summary) {
      console.error(`missing function summary for ${p}::${f.name}`);
      process.exit(1);
    }
    const node = {
      id: `function:${p}:${f.name}`,
      type: 'function',
      name: f.name,
      filePath: p,
      lineRange: [f.startLine, f.endLine],
      summary: trunc(summary),
      tags: meta.fnTags,
      complexity: symComplexity(lines),
    };
    nodes.push(node);
    nodeIds.add(node.id);
  }
  for (const c of r.classes || []) {
    const lines = c.endLine - c.startLine + 1;
    const exported = exportNames.has(c.name);
    if (!(((c.methods || []).length >= 2 || lines >= 20) || exported)) continue;
    const summary = data.overrides[`${p}::${c.name}`];
    if (!summary) {
      console.error(`missing class summary for ${p}::${c.name}`);
      process.exit(1);
    }
    const node = {
      id: `class:${p}:${c.name}`,
      type: 'class',
      name: c.name,
      filePath: p,
      lineRange: [c.startLine, c.endLine],
      summary: trunc(summary),
      tags: meta.fnTags,
      complexity: symComplexity(lines),
    };
    nodes.push(node);
    nodeIds.add(node.id);
  }
}

// ── edges ───────────────────────────────────────────────────────────────────
const edges = [];
const edgeSet = new Set();
function pushEdge(source, target, type, weight) {
  if (source === target) return; // không self-edge
  const key = `${source}|${target}|${type}`;
  if (edgeSet.has(key)) return;
  edgeSet.add(key);
  edges.push({ source, target, type, direction: 'forward', weight });
}

// contains + exports
for (const n of nodes) {
  if (n.type === 'file' || n.type === 'config' || n.type === 'document' || n.type === 'schema') continue;
  pushEdge(`${n.type === 'class' ? 'file' : 'file'}:${n.filePath}`, n.id, 'contains', 1.0);
  pushEdge(`file:${n.filePath}`, n.id, 'exports', 0.8);
}

// imports — 1:1 batchImportData (đúng tổng, không sót)
let importCount = 0;
for (const [src, targets] of Object.entries(batch.batchImportData)) {
  for (const t of targets) {
    pushEdge(idFor(src), idFor(t), 'imports', 0.7);
    importCount += 1;
  }
}

// calls — hand-curated (callerId, calleeId) trong data.calls
for (const [src, dst] of data.calls || []) {
  pushEdge(src, dst, 'calls', 0.8);
}

// inherits — hand-listed
for (const [src, dst] of data.inherits || []) {
  pushEdge(src, dst, 'inherits', 0.9);
}

// tested_by — neighborMap + hand-listed
for (const [src, neighbors] of Object.entries(batch.neighborMap || {})) {
  for (const nb of neighbors) {
    pushEdge(idFor(src), idFor(nb.path), 'tested_by', 0.5);
  }
}
for (const [src, dst] of data.testedBy || []) {
  pushEdge(src, dst, 'tested_by', 0.5);
}

// extra non-code edges
for (const e of data.extraEdges) {
  pushEdge(e[0], e[1], e[2], e[3] ?? 0.6);
}

// ── validation ──────────────────────────────────────────────────────────────
const importEntries = Object.values(batch.batchImportData).reduce((a, t) => a + t.length, 0);
const importEdges = edges.filter((e) => e.type === 'imports').length;
if (importEntries !== importCount || importEntries !== importEdges) {
  console.error(`imports mismatch: entries=${importEntries} pushed=${importCount} edges=${importEdges}`);
  process.exit(1);
}
for (const n of nodes) {
  if (!/^(file|config|document|schema|function|class|service|endpoint|table|resource|pipeline):/.test(n.id)) {
    console.error(`bad node id: ${n.id}`);
    process.exit(1);
  }
  if (!Array.isArray(n.tags) || n.tags.length < 3 || n.tags.length > 5) {
    console.error(`bad tags on ${n.id}`);
    process.exit(1);
  }
}
for (const e of edges) {
  if (e.source === e.target) {
    console.error(`self-edge: ${e.source}`);
    process.exit(1);
  }
}
const ids = new Set(nodes.map((n) => n.id));
if (ids.size !== nodes.length) {
  console.error('duplicate node ids');
  process.exit(1);
}

// ── write ───────────────────────────────────────────────────────────────────
const out = { batchIndex: IDX, batchFiles: batch.files, nodes, edges };
const outPath = join(UA_DIR, `intermediate/batch-${IDX}.json`);
writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n', 'utf-8');

const typeCounts = {};
for (const e of edges) typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
console.log(
  `batch ${IDX}: files=${batch.files.length} nodes=${nodes.length} edges=${edges.length} (${Object.entries(typeCounts)
    .map(([k, v]) => `${k}:${v}`)
    .join(' ')}) importsTotal=${importCount}`,
);
