#!/usr/bin/env node
// Architecture structural analysis: usage: node ua-arch-analyze.js <input> <output>
import { readFileSync, writeFileSync } from 'node:fs';

function topDir(filePath) {
  const p = String(filePath || '').replace(/\\/g, '/');
  if (p.startsWith('src/screens/')) return 'screens';
  if (p.startsWith('src/')) return 'src';
  if (p.startsWith('.figma/make/')) return '.figma/make';
  const first = p.split('/')[0];
  return p.includes('/') ? first : '.';
}

function main() {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) {
    console.error('usage: node ua-arch-analyze.js <input> <output>');
    process.exit(2);
  }
  const input = JSON.parse(readFileSync(inputPath, 'utf8'));
  const nodes = input.fileNodes || [];
  const importEdges = input.importEdges || [];
  const allEdges = input.allEdges || [];

  const byId = new Map(nodes.map(n => [n.id, n]));
  const dirOf = n => topDir(n.filePath || n.id);
  const rel = e =>
    byId.has(e.source) && byId.has(e.target)
      ? [dirOf(byId.get(e.source)), dirOf(byId.get(e.target))]
      : null;

  // --- directoryGroups ---
  const dirGroups = {};
  for (const n of nodes) {
    const d = dirOf(n);
    (dirGroups[d] = dirGroups[d] || { fileCount: 0, nodeIds: [], types: {} });
    dirGroups[d].fileCount++;
    dirGroups[d].nodeIds.push(n.id);
    dirGroups[d].types[n.type] = (dirGroups[d].types[n.type] || 0) + 1;
  }

  // --- nodeTypeGroups ---
  const nodeTypeGroups = {};
  for (const n of nodes) {
    (nodeTypeGroups[n.type] = nodeTypeGroups[n.type] || []).push(n.id);
  }

  // --- crossCategoryEdges: edges crossing node-type categories ---
  const crossCategoryEdges = [];
  for (const e of allEdges) {
    const s = byId.get(e.source), t = byId.get(e.target);
    if (s && t && s.type !== t.type) {
      crossCategoryEdges.push({ source: e.source, target: e.target, type: e.type, fromType: s.type, toType: t.type });
    }
  }

  // --- interGroupImports (directional matrix) + interGroupAllEdges ---
  const interGroupImports = {};
  const interGroupAll = {};
  for (const e of allEdges) {
    const r = rel(e);
    if (!r) continue;
    const [a, b] = r;
    if (a === b) continue;
    const key = `${a}->${b}`;
    if (e.type === 'imports') interGroupImports[key] = (interGroupImports[key] || 0) + 1;
    interGroupAll[key] = (interGroupAll[key] || 0) + 1;
  }

  // --- intraGroupDensity per directory group ---
  const intraGroupDensity = {};
  for (const [d, g] of Object.entries(dirGroups)) {
    const n = g.nodeIds.length;
    const possible = (n * (n - 1)) / 2;
    let intraImports = 0, intraAll = 0;
    for (const e of allEdges) {
      const r = rel(e);
      if (!r) continue;
      if (r[0] === d && r[1] === d) {
        intraAll++;
        if (e.type === 'imports') intraImports++;
      }
    }
    intraGroupDensity[d] = {
      fileCount: n,
      intraImports,
      intraAllEdges: intraAll,
      importDensity: possible ? +(intraImports / possible).toFixed(4) : 0,
      allEdgeDensity: possible ? +(intraAll / possible).toFixed(4) : 0,
    };
  }

  // --- patternMatches (heuristics over graph signals) ---
  const fanInImports = {}, fanOutImports = {};
  for (const e of importEdges) {
    fanInImports[e.target] = (fanInImports[e.target] || 0) + 1;
    fanOutImports[e.source] = (fanOutImports[e.source] || 0) + 1;
  }
  const hubFiles = Object.entries(fanInImports)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([id, c]) => ({ id, imports: c }));

  const patternMatches = [];
  const screens = (dirGroups['screens'] || { nodeIds: [] }).nodeIds;
  if (screens.length >= 10) {
    patternMatches.push({
      pattern: 'screens-directory-ui-layer',
      evidence: `${screens.length} files under src/screens/ grouped as one UI screens layer`,
    });
  }
  const storeHub = fanInImports['file:src/store.tsx'] || 0;
  if (storeHub >= 10) {
    patternMatches.push({
      pattern: 'central-store-context',
      evidence: `src/store.tsx is imported by ${storeHub} files (central React Context store)`,
    });
  }
  const uiHub = fanInImports['file:src/ui.tsx'] || 0;
  if (uiHub >= 10) {
    patternMatches.push({
      pattern: 'shared-ui-primitives',
      evidence: `src/ui.tsx is imported by ${uiHub} files (shared design-system primitives)`,
    });
  }
  const shellHub = fanInImports['file:src/shell.tsx'] || 0;
  if (shellHub >= 3) {
    patternMatches.push({
      pattern: 'app-shell-layout',
      evidence: `src/shell.tsx imported by ${shellHub} files (layout shell around screens)`,
    });
  }
  const dataHub = fanInImports['file:src/data.ts'] || 0;
  const storeImportsData = importEdges.some(e => e.source === 'file:src/store.tsx' && e.target === 'file:src/data.ts');
  if (dataHub > 0 || storeImportsData) {
    patternMatches.push({
      pattern: 'seed-data-module',
      evidence: `src/data.ts imported by ${dataHub} files; store imports data: ${storeImportsData}`,
    });
  }
  const entryRouting = ['file:src/App.tsx', 'file:src/main.tsx'].filter(id => byId.has(id));
  if (entryRouting.length === 2) {
    patternMatches.push({
      pattern: 'entry-point-routing',
      evidence: 'main.tsx mounts app; App.tsx holds ROUTES table + route switch',
    });
  }
  const cfgCount = (nodeTypeGroups['config'] || []).length;
  if (cfgCount > 0) {
    patternMatches.push({
      pattern: 'config-tooling-layer',
      evidence: `${cfgCount} config nodes (package.json, tsconfig.json, vite.config.ts-area, .figma/make, .mise.toml, .ua/config.json)`,
    });
  }
  if ((nodeTypeGroups['document'] || []).length > 0) {
    patternMatches.push({
      pattern: 'docs-layer',
      evidence: `${(nodeTypeGroups['document'] || []).length} document nodes (AGENTS.md, implementation-plan.md)`,
    });
  }
  const hasCss = nodes.some(n => String(n.filePath || '').endsWith('.css'));
  if (hasCss) {
    patternMatches.push({ pattern: 'global-stylesheet', evidence: 'src/index.css = Tailwind CSS v4 entry with @font-face/theme' });
  }

  // --- deploymentTopology ---
  const deploy = {
    model: 'single-page-static-spa',
    buildTool: 'vite-8',
    framework: 'react-19',
    styling: 'tailwindcss-v4',
    entries: nodes.filter(n => /index\.html$|main\.tsx$/.test(String(n.filePath || ''))).map(n => n.filePath),
    serverRuntime: 'none-detected (no backend/service/table/endpoint nodes)',
    notes: 'Static build output of Vite; Figma Make wrapper scripts under .figma/make; npm scripts in package.json',
  };

  // --- dataPipeline (inferred from import chain) ---
  const impSet = new Set(importEdges.map(e => `${e.source}|${e.target}`));
  const chain = [];
  if (impSet.has('file:src/store.tsx|file:src/data.ts')) chain.push('src/data.ts -> src/store.tsx');
  if (impSet.has('file:src/App.tsx|file:src/store.tsx')) chain.push('src/store.tsx -> src/App.tsx');
  let screensUseStore = 0, screensUseData = 0;
  for (const e of importEdges) {
    if (dirOf(byId.get(e.source)) === 'screens') {
      if (e.target === 'file:src/store.tsx') screensUseStore++;
      if (e.target === 'file:src/data.ts') screensUseData++;
    }
  }
  const dataPipeline = {
    chain,
    screensImportingStore: screensUseStore,
    screensImportingDataDirectly: screensUseData,
    description:
      'Unidirectional flow: data.ts (types + seed data) -> store.tsx (React Context store) -> screens via hook; ui.tsx/shell.tsx consume store for navigation/theme',
  };

  // --- docCoverage ---
  const withSummary = nodes.filter(n => (n.summary || '').trim().length > 0).length;
  const docNodes = nodeTypeGroups['document'] || [];
  const docEdgeTargets = new Set(allEdges.filter(e => e.type === 'documents').map(e => e.target));
  const docCoverage = {
    totalFileNodes: nodes.length,
    nodesWithSummary: withSummary,
    summaryCoverage: +((withSummary / nodes.length) * 100).toFixed(1),
    documentNodes: docNodes,
    documentsEdges: allEdges.filter(e => e.type === 'documents').length,
    docEdgeTargets: [...docEdgeTargets],
  };

  // --- dependencyDirection: verify upward flow (screens -> base layers) ---
  const tier = { screens: 3, src: 2, '.figma/make': 0, '.': 1, '.ua': 0 };
  let upward = 0, downward = 0, lateral = 0;
  const violations = [];
  for (const e of importEdges) {
    const r = rel(e);
    if (!r) continue;
    const [a, b] = r;
    const ta = tier[a] ?? 2, tb = tier[b] ?? 2;
    if (ta > tb) upward++;
    else if (ta < tb) { downward++; violations.push(`${e.source} -> ${e.target}`); }
    else lateral++;
  }
  const dependencyDirection = {
    orientation: 'UI (screens) -> state/data -> base; higher tier imports lower tier',
    upwardImports: upward,
    lateralImports: lateral,
    downwardImports: downward,
    violations,
    matrix: interGroupImports,
  };

  // --- fileStats / fan-in / fan-out (all file-level edges) ---
  const fanIn = {}, fanOut = {};
  for (const e of allEdges) {
    fanIn[e.target] = (fanIn[e.target] || 0) + 1;
    fanOut[e.source] = (fanOut[e.source] || 0) + 1;
  }
  const fileStats = {
    totalFileNodes: nodes.length,
    byType: Object.fromEntries(Object.entries(nodeTypeGroups).map(([k, v]) => [k, v.length])),
    totalFileLevelEdges: allEdges.length,
    imports: importEdges.length,
    isolatedNodes: nodes.filter(n => !fanIn[n.id] && !fanOut[n.id]).map(n => n.id),
    topFanIn: hubFiles,
  };

  const results = {
    directoryGroups: dirGroups,
    nodeTypeGroups,
    crossCategoryEdges,
    interGroupImports,
    interGroupAllEdges: interGroupAll,
    intraGroupDensity,
    patternMatches,
    deploymentTopology: deploy,
    dataPipeline,
    docCoverage,
    dependencyDirection,
    fileStats,
    fileFanIn: fanIn,
    fileFanOut: fanOut,
  };
  writeFileSync(outputPath, JSON.stringify(results, null, 1));
  console.log('OK wrote', outputPath, '| fileNodes:', nodes.length, '| patterns:', patternMatches.length);
}

try {
  main();
} catch (err) {
  console.error('FAILED:', err && err.stack || err);
  process.exit(1);
}
