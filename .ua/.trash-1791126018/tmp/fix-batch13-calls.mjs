// Insert the missing calls edge into batch-13.json
import { readFileSync, writeFileSync } from 'node:fs';

const path = 'D:/.VTNet/redteam/raptix/.ua/intermediate/batch-13.json';
const raw = readFileSync(path, 'utf-8');
const data = JSON.parse(raw);

const edge = {
  source: 'function:packages/raptix-core/tests/test_plugin_registry.py:test_single_plugin_per_group_yields_one_plugin_info',
  target: 'class:packages/raptix-core/raptix_core/registry/plugins.py:PluginInfo',
  type: 'calls',
  direction: 'forward',
  weight: 0.8,
};

const dup = data.edges.some(
  e => e.type === edge.type && e.source === edge.source && e.target === edge.target,
);
if (dup) {
  console.log('edge already present; nothing to do');
  process.exit(0);
}

// insert after the caller's last existing edge (position 393)
const callerIdx = data.edges.map((e, i) => (e.source === edge.source && e.type === 'calls' ? i : -1)).filter(i => i >= 0);
const insertAt = callerIdx.length > 0 ? callerIdx[callerIdx.length - 1] + 1 : data.edges.length;
data.edges.splice(insertAt, 0, edge);

writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf-8');
console.log(`inserted at index ${insertAt}; total edges now ${data.edges.length}`);
