#!/usr/bin/env node
// Tour topology analyzer.
// Usage: node ua-tour-analyze.js <input> <output>
import fs from 'node:fs';
import path from 'node:path';

function main() {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) {
    console.error('Usage: node ua-tour-analyze.js <input> <output>');
    process.exit(2);
  }
  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const nodes = input.nodes || [];
  const edges = input.edges || [];
  const layersIn = input.layers || [];

  const byId = new Map(nodes.map(n => [n.id, n]));
  const fanIn = new Map();
  const fanOut = new Map();
  for (const n of nodes) { fanIn.set(n.id, 0); fanOut.set(n.id, 0); }
  for (const e of edges) {
    if (fanIn.has(e.target)) fanIn.set(e.target, fanIn.get(e.target) + 1);
    if (fanOut.has(e.source)) fanOut.set(e.source, fanOut.get(e.source) + 1);
  }

  const rank = (map) => nodes
    .map(n => ({ id: n.id, name: n.name, type: n.type, count: map.get(n.id) || 0 }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
    .slice(0, 20);
  const fanInRanking = rank(fanIn);
  const fanOutRanking = rank(fanOut);

  const CODE_RE = /\.(tsx?|jsx?|mjs)$/i;
  const isCodeFile = (n) => {
    const fp = (n.filePath || n.name || '').replace(/\\/g, '/');
    return n.type === 'file' && CODE_RE.test(fp);
  };
  const candidates = nodes.map(n => {
    const fp = (n.filePath || n.name || '').replace(/\\/g, '/');
    const base = path.basename(fp).toLowerCase();
    const depth = fp.split('/').length - 1;
    let score = 0;
    const reasons = [];
    if (isCodeFile(n) && /^(main|app|index)\./.test(base)) {
      score += 3; reasons.push('main/App filename pattern +3');
    }
    if (depth <= 1) { score += 1; reasons.push('shallow depth +1'); }
    if ((fanOut.get(n.id) || 0) >= 3) { score += 1; reasons.push('high fan-out +1'); }
    if ((fanIn.get(n.id) || 0) <= 1) { score += 1; reasons.push('low fan-in +1'); }
    if (n.type === 'document') {
      const isGuideDoc = !fp.includes('/') && /agents|readme|claude|contributing/i.test(base);
      score += isGuideDoc ? 5 : 2;
      reasons.push(isGuideDoc ? 'root guide-class doc +5' : 'root doc +2');
    }
    return {
      id: n.id, name: n.name, type: n.type, filePath: fp,
      score, reasons,
      fanIn: fanIn.get(n.id) || 0, fanOut: fanOut.get(n.id) || 0,
      isCode: isCodeFile(n)
    };
  }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  const topCodeEntry = candidates.find(c => c.isCode) || null;

  const adj = new Map();
  for (const e of edges) {
    if (!['imports', 'calls', 'depends_on'].includes(e.type)) continue;
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source).push(e.target);
  }
  const bfsTraversal = { start: topCodeEntry ? topCodeEntry.id : null, order: [], depthMap: {}, byDepth: {} };
  if (topCodeEntry) {
    const seen = new Set([topCodeEntry.id]);
    let frontier = [topCodeEntry.id];
    let depth = 0;
    while (frontier.length) {
      const sorted = [...frontier].sort();
      for (const id of sorted) {
        bfsTraversal.order.push(id);
        bfsTraversal.depthMap[id] = depth;
        (bfsTraversal.byDepth[depth] = bfsTraversal.byDepth[depth] || []).push(id);
      }
      const next = [];
      for (const id of sorted) {
        for (const t of adj.get(id) || []) {
          if (!seen.has(t)) { seen.add(t); next.push(t); }
        }
      }
      frontier = next;
      depth += 1;
    }
  }

  const NONCODE_RE = /\.(md|json|toml|html|css|d\.ts|gitattributes|mjs)$/i;
  const nonCodeFiles = nodes.filter(n => {
    const fp = (n.filePath || '').replace(/\\/g, '/');
    return n.type === 'document' || n.type === 'config' ||
      NONCODE_RE.test(fp) || fp.startsWith('.figma/') || fp.startsWith('.ua/');
  }).map(n => ({
    id: n.id, name: n.name, type: n.type,
    filePath: (n.filePath || n.name || '').replace(/\\/g, '/'),
    summary: n.summary || ''
  }));

  // Clusters: maximal cliques (Bron-Kerbosch), trimmed to <=5 members.
  const idList = nodes.map(n => n.id);
  const idx = new Map(idList.map((id, i) => [id, i]));
  const adjSets = idList.map(() => new Set());
  const weight = new Map();
  for (const e of edges) {
    if (!idx.has(e.source) || !idx.has(e.target)) continue;
    const a = idx.get(e.source), b = idx.get(e.target);
    if (a === b) continue;
    adjSets[a].add(b); adjSets[b].add(a);
    const key = a < b ? a + ':' + b : b + ':' + a;
    weight.set(key, (weight.get(key) || 0) + (e.weight || 1));
  }
  const cliques = [];
  const bk = (R, P, X) => {
    if (cliques.length > 5000) return;
    if (P.size === 0 && X.size === 0) { if (R.size) cliques.push([...R]); return; }
    let pivot = -1, best = -1;
    for (const u of new Set([...P, ...X])) {
      let c = 0;
      for (const w of adjSets[u]) if (P.has(w) || X.has(w)) c++;
      if (c > best) { best = c; pivot = u; }
    }
    for (const v of [...P].filter(v => !adjSets[pivot].has(v))) {
      R.add(v);
      bk(R,
        new Set([...P].filter(w => adjSets[v].has(w))),
        new Set([...X].filter(w => adjSets[v].has(w))));
      R.delete(v);
      P.delete(v); X.add(v);
    }
  };
  bk(new Set(), new Set(idList.map((_, i) => i)), new Set());

  const strength = (memberIdxs) => {
    let w = 0;
    for (let i = 0; i < memberIdxs.length; i++)
      for (let j = i + 1; j < memberIdxs.length; j++) {
        const a = memberIdxs[i], b = memberIdxs[j];
        w += weight.get(a < b ? a + ':' + b : b + ':' + a) || 0;
      }
    return w;
  };

  const clusterDrafts = [];
  for (const c of cliques) {
    if (c.length < 2) continue;
    let members = [...c].sort((a, b) => a - b);
    if (members.length > 5) {
      members = members
        .map(i => ({ i, s: (fanIn.get(idList[i]) || 0) + (fanOut.get(idList[i]) || 0) }))
        .sort((a, b) => b.s - a.s || a.i - b.i)
        .slice(0, 5)
        .map(x => x.i)
        .sort((a, b) => a - b);
    }
    const nodeIds = members.map(i => idList[i]);
    const key = nodeIds.join('|');
    clusterDrafts.push({ nodeIds, size: nodeIds.length, strength: strength(members) });
  }
  clusterDrafts.sort((a, b) => b.strength - a.strength || b.size - a.size);
  const clusters = [];
  for (const c of clusterDrafts) {
    if (clusters.length >= 10) break;
    const overlap = clusters.some(cl => {
      const shared = c.nodeIds.filter(id => cl.nodeIds.includes(id)).length;
      return shared >= Math.min(c.size, cl.size) * 0.6;
    });
    if (!overlap) clusters.push({ nodeIds: c.nodeIds, size: c.size, strength: c.strength });
  }

  const layers = layersIn.map(l => ({
    id: l.id, name: l.name, description: l.description,
    nodeCount: (l.nodeIds || []).filter(id => byId.has(id)).length
  }));

  const nodeSummaryIndex = {};
  for (const n of nodes) {
    nodeSummaryIndex[n.id] = { name: n.name, type: n.type, summary: n.summary || '' };
  }

  const results = {
    entryPointCandidates: candidates.slice(0, 10),
    topCodeEntryPoint: topCodeEntry,
    fanInRanking,
    fanOutRanking,
    bfsTraversal,
    nonCodeFiles,
    clusters,
    layers,
    nodeSummaryIndex,
    totalNodes: nodes.length,
    totalEdges: edges.length
  };

  fs.writeFileSync(outputPath, JSON.stringify(results, null, 1));
  console.log('OK nodes=' + nodes.length + ' edges=' + edges.length +
    ' entry=' + (topCodeEntry ? topCodeEntry.id : 'none') +
    ' bfs=' + bfsTraversal.order.length + ' clusters=' + clusters.length);
}

try { main(); } catch (err) {
  console.error(err && err.stack || String(err));
  process.exit(1);
}
