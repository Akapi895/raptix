import fs from 'node:fs';

const UA = 'D:/.VTNet/redteam/raptix/packages/raptix/.ua';

export function humanize(name) {
  return name.replace(/^test_/, '').replace(/_/g, ' ').trim();
}

function camelToSnake(s) {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/_/g, '-').toLowerCase();
}

export function generate(batchIndex, cfg) {
  const batches = JSON.parse(fs.readFileSync(`${UA}/intermediate/batches.json`, 'utf8'));
  const bt = batches.batches.find((b) => b.batchIndex === batchIndex);
  if (!bt) throw new Error(`batch ${batchIndex} not found`);
  const extract = JSON.parse(fs.readFileSync(`${UA}/tmp/ua-file-extract-results-${batchIndex}.json`, 'utf8'));

  const nodes = [];
  const edges = [];
  const emitted = new Map();

  const fCfg = (p) => cfg.files[p] || {};
  const sCfg = (p, name) => (cfg.symbols[pathKey(p, name)] || null);

  function pathKey(p, name) { return `${p}::${name}`; }

  function padTags(tags, fallback) {
    const out = [...tags];
    for (const t of fallback) {
      if (out.length >= 3) break;
      if (!out.includes(t)) out.push(t);
    }
    while (out.length < 3) out.push('code');
    return out.slice(0, 5);
  }

  function symbolComplexity(start, end) {
    const n = end - start + 1;
    if (n > 120) return 'complex';
    if (n >= 30) return 'moderate';
    return 'simple';
  }

  for (const res of extract.results) {
    const p = res.path;
    const fc = fCfg(p);
    const isTest = p.startsWith('tests/');
    const fileId = `file:${p}`;
    const base = p.split('/').pop();
    emitted.set(fileId, true);

    nodes.push({
      id: fileId,
      type: 'file',
      name: base,
      filePath: p,
      summary: fc.summary || `Module Python ${base} trong dự án Raptix.`,
      tags: fc.tags || ['python', 'code', 'raptix'],
      complexity: fc.complexity || (res.totalLines > 200 ? 'complex' : res.totalLines >= 50 ? 'moderate' : 'simple'),
      ...(fc.languageNotes ? { languageNotes: fc.languageNotes } : {}),
    });

    const symDefaultTags = fc.symbolTags || ['python', base.replace(/\.py$/, ''), 'code'];

    for (const fn of res.functions || []) {
      const lines = fn.endLine - fn.startLine + 1;
      const isPrivate = fn.name.startsWith('_') && !fn.name.startsWith('__');
      const isTestFn = fn.name.startsWith('test_');
      const listed = !!sCfg(p, fn.name);
      let emit = lines >= 10 || listed;
      if (isTestFn && lines < 10 && !listed) emit = false;
      if (isPrivate && lines < 10 && !listed) emit = false;
      if (!emit) continue;
      const c = sCfg(p, fn.name) || {};
      const id = `function:${p}:${fn.name}`;
      if (emitted.has(id)) continue;
      emitted.set(id, true);
      const publicName = !fn.name.startsWith('_');
      nodes.push({
        id,
        type: 'function',
        name: fn.name,
        filePath: p,
        lineRange: [fn.startLine, fn.endLine],
        summary: c.summary || (isTestFn
          ? `Trường hợp kiểm thử: kiểm tra ${humanize(fn.name)}.`
          : `Hàm ${fn.name} của ${base}.`),
        tags: padTags(c.tags || (isTestFn ? ['test', 'unit', base.replace(/\.py$/, '')] : symDefaultTags), ['python', 'code']),
        complexity: c.complexity || symbolComplexity(fn.startLine, fn.endLine),
      });
      edges.push({ source: fileId, target: id, type: 'contains', direction: 'forward', weight: 1.0 });
      if (!isTest && publicName) {
        edges.push({ source: fileId, target: id, type: 'exports', direction: 'forward', weight: 0.8 });
      }
    }

    for (const cls of res.classes || []) {
      const lines = cls.endLine - cls.startLine + 1;
      const methodCount = (cls.methods || []).length;
      const isPrivate = cls.name.startsWith('_');
      const listed = !!sCfg(p, cls.name);
      const emit = methodCount >= 2 || lines >= 20 || listed || (!isPrivate && lines >= 6);
      if (!emit) continue;
      const c = sCfg(p, cls.name) || {};
      const id = `class:${p}:${cls.name}`;
      if (emitted.has(id)) continue;
      emitted.set(id, true);
      const publicName = !cls.name.startsWith('_');
      const isTestCls = /^(Test|_Fake)/.test(cls.name);
      nodes.push({
        id,
        type: 'class',
        name: cls.name,
        filePath: p,
        lineRange: [cls.startLine, cls.endLine],
        summary: c.summary || (/^_Fake/.test(cls.name)
          ? `Lớp giả lập (test double) ${cls.name}, thay thế dependency thật trong unit test.`
          : /^Test/.test(cls.name)
            ? `Bộ kiểm thử đơn vị cho ${humanize(cls.name.replace(/^Test/, ''))}.`
            : `Lớp ${cls.name} của ${base}.`),
        tags: padTags(c.tags || (isTestCls ? ['test', 'fixture', base.replace(/\.py$/, '')] : symDefaultTags), ['python', 'code']),
        complexity: c.complexity || symbolComplexity(cls.startLine, cls.endLine),
      });
      edges.push({ source: fileId, target: id, type: 'contains', direction: 'forward', weight: 1.0 });
      if (!isTest && publicName) {
        edges.push({ source: fileId, target: id, type: 'exports', direction: 'forward', weight: 0.8 });
      }
    }
  }

  let importCount = 0;
  for (const [src, targets] of Object.entries(bt.batchImportData)) {
    for (const t of targets) {
      if (src === t) continue;
      edges.push({ source: `file:${src}`, target: `file:${t}`, type: 'imports', direction: 'forward', weight: 0.7 });
      importCount++;
    }
  }

  let testedBy = 0;
  for (const [src, targets] of Object.entries(bt.batchImportData)) {
    if (!src.startsWith('tests/')) continue;
    for (const t of targets) {
      if (t.startsWith('tests/')) continue;
      if (!emitted.has(`file:${t}`)) continue;
      edges.push({ source: `file:${t}`, target: `file:${src}`, type: 'tested_by', direction: 'forward', weight: 0.5 });
      testedBy++;
    }
  }

  for (const c of cfg.calls || []) {
    if (c.source === c.target) continue;
    edges.push({ source: c.source, target: c.target, type: 'calls', direction: 'forward', weight: 0.8 });
  }
  for (const c of cfg.extraEdges || []) {
    if (c.source === c.target) continue;
    edges.push({ source: c.source, target: c.target, type: c.type, direction: 'forward', weight: c.weight ?? 0.6 });
  }

  const out = {
    batchIndex,
    batchFiles: bt.files.map((f) => ({ path: f.path, language: f.language, sizeLines: f.sizeLines, fileCategory: f.fileCategory })),
    nodes,
    edges,
  };

  const outPath = `${UA}/intermediate/batch-${batchIndex}.json`;
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  const expectedImports = Object.values(bt.batchImportData).reduce((a, v) => a + v.length, 0);
  const actualImports = edges.filter((e) => e.type === 'imports').length;
  console.log(`batch ${batchIndex}: nodes=${nodes.length} edges=${edges.length} imports=${actualImports}/${expectedImports} tested_by=${testedBy}`);
  if (actualImports !== expectedImports) {
    console.error(`ERROR: import edge mismatch for batch ${batchIndex}`);
    process.exit(1);
  }
}
