import { readFileSync, writeFileSync } from 'node:fs';

export const UA = 'D:/.VTNet/redteam/raptix/packages/raptix/.ua';
export const input = (idx) =>
  JSON.parse(readFileSync(`${UA}/tmp/ua-file-analyzer-input-${idx}.json`, 'utf-8'));

const W = { contains: 1.0, exports: 0.8, imports: 0.7, calls: 0.8, tested_by: 0.5 };

const AUGMENT = {
  'test-fixture': 'helper', 'test': 'unit-test', 'utility': 'helper', 'singleton': 'session',
  'enumeration': 'siem', 'data-model': 'dataclass', 'nftables': 'ruleset', 'dns': 'network',
  'lucene': 'sigma', 'kql': 'sigma', 'spl': 'sigma', 'langchain-tool': 'json-output',
  'navigation': 'browser', 'configuration': 'conops', 'normalization': 'string-processing',
  'interaction': 'browser-action', 'screenshot': 'browser', 'javascript': 'eval',
  'console': 'logging', 'tabs': 'browser', 'logging': 'diagnostics', 'truncation': 'string-processing',
  'interrupt': 'langgraph', 'event': 'stream', 'coercion': 'pydantic', 'robustness': 'error-handling',
  'discovery': 'network', 'apply': 'nftables', 'error-handling': 'robustness', 'fail-closed': 'security',
  'render': 'nftables', 'policy': 'security', 'ip': 'network', 'naming': 'slug', 'loader': 'json',
  'packer-detection': 'entropy', 'rop': 'exploitation', 'script-generation': 'template',
  'format-detection': 'binary-analysis', 'elf': 'binary', 'pe': 'binary', 'validation': 'input-validation',
  'hitl': 'operator', 'cleanup': 'timeout', 'session': 'playwright', 'egress': 'firewall',
};
function augmentTags(tags, filePath) {
  const t = [...tags];
  if (t.length >= 3) return t;
  for (const key of t) {
    const extra = AUGMENT[key];
    if (extra && !t.includes(extra)) { t.push(extra); break; }
  }
  if (t.length < 3) t.push(filePath.includes('test') ? 'pytest' : 'implementation');
  return t;
}

export const fileN = (path, summary, tags, complexity, languageNotes) => {
  const name = path.split('/').pop();
  const n = { id: `file:${path}`, type: 'file', name, filePath: path, summary, tags: augmentTags(tags, path), complexity };
  if (languageNotes) n.languageNotes = languageNotes;
  return n;
};
export const fnN = (path, name, lr, summary, tags, complexity) => ({
  id: `function:${path}:${name}`, type: 'function', name, filePath: path, lineRange: lr, summary, tags: augmentTags(tags, path), complexity,
});
export const clsN = (path, name, lr, summary, tags, complexity) => ({
  id: `class:${path}:${name}`, type: 'class', name, filePath: path, lineRange: lr, summary, tags: augmentTags(tags, path), complexity,
});
export const E = (source, target, type) => ({ source, target, type, direction: 'forward', weight: W[type] });
export const contains = (node) => E(`file:${node.filePath}`, node.id, 'contains');
export const exportsFrom = (node) => E(`file:${node.filePath}`, node.id, 'exports');
export const importEdges = (importData) => {
  const out = [];
  for (const [src, targets] of Object.entries(importData)) {
    for (const t of targets) out.push(E(`file:${src}`, `file:${t}`, 'imports'));
  }
  return out;
};

export function finish(idx, nodes, edges) {
  const inp = input(idx);
  validate(idx, inp.batchFiles, inp.batchImportData, nodes, edges);
  const out = { batchIndex: idx, batchFiles: inp.batchFiles, nodes, edges };
  writeFileSync(`${UA}/intermediate/batch-${idx}.json`, JSON.stringify(out, null, 2), 'utf-8');
  console.log(`batch-${idx}.json: ${nodes.length} nodes, ${edges.length} edges`);
}

function validate(idx, batchFiles, importData, nodes, edges) {
  const ids = new Set(nodes.map((n) => n.id));
  if (ids.size !== nodes.length) throw new Error(`batch ${idx}: duplicate node ids`);
  for (const n of nodes) {
    if (!/^((file|config|document|service|pipeline|schema|resource|table|endpoint):[^:]+|(function|class):[^:]+:[^:]+)$/.test(n.id))
      throw new Error(`batch ${idx}: bad id ${n.id}`);
    if (!n.summary || n.tags.length < 3 || n.tags.length > 5) throw new Error(`batch ${idx}: bad meta ${n.id}`);
    if (!['simple', 'moderate', 'complex'].includes(n.complexity)) throw new Error(`batch ${idx}: bad complexity ${n.id}`);
    if (!/^[a-z0-9-]+$/.test(n.tags.join(''))) throw new Error(`batch ${idx}: tag format ${n.id}`);
  }
  const importSum = Object.values(importData).reduce((a, v) => a + v.length, 0);
  const importCount = edges.filter((e) => e.type === 'imports').length;
  if (importSum !== importCount) throw new Error(`batch ${idx}: imports ${importCount} != required ${importSum}`);
  for (const [src, targets] of Object.entries(importData)) {
    const emitted = edges.filter((e) => e.type === 'imports' && e.source === `file:${src}`).map((e) => e.target).sort();
    const expected = targets.map((t) => `file:${t}`).sort();
    if (JSON.stringify(emitted) !== JSON.stringify(expected))
      throw new Error(`batch ${idx}: import mismatch for ${src}`);
  }
  for (const e of edges) {
    if (e.source === e.target) throw new Error(`batch ${idx}: self-edge ${e.source}`);
  }
  const nodeFiles = new Set(nodes.filter((n) => n.type === 'file').map((n) => n.filePath));
  for (const f of batchFiles) if (!nodeFiles.has(f.path)) throw new Error(`batch ${idx}: missing file node ${f.path}`);
}
