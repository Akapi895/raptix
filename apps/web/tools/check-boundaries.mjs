// Checks the web module boundaries of apps/web/src (ADR-0096). Read-only; uses the TypeScript AST.
// Usage: node tools/check-boundaries.mjs [--strict] [--json]
//   default: prints a count per rule and exits 0 (baseline reporting)
//   --strict: exits 1 when any violation is found
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..', 'src');
const strict = process.argv.includes('--strict');
const asJson = process.argv.includes('--json');

// Paths below are relative to src, without extension.
const DEMO_PATTERNS = [/^demo(\/|$)/, /^state\/services$/, /^screens\/demo(\/|$)/, /^features\/[^/]+\/mock$/];
const MOCK_PLUMBING = new Set(['useServices', 'useServicesOrNull', 'isRealMode', 'DATA_MODE', 'MockClock']);

const stripExt = (rel) => rel.replace(/\.(ts|tsx)$/, '');
const isDemoSide = (noExt) => DEMO_PATTERNS.some((re) => re.test(noExt));
const isTest = (rel) => /\.test\.(ts|tsx)$/.test(rel);
const isPresentation = (rel) => /\.tsx$/.test(rel) && !isTest(rel)
  && (/^features\//.test(rel) || /^screens\//.test(rel) || /^real\/screens\//.test(rel) || /^shell\//.test(rel));

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

// Resolves a module specifier to a path relative to src, without extension. Package imports return null.
function resolveSpec(fromRel, spec) {
  if (spec.startsWith('@/')) return spec.slice(2);
  if (!spec.startsWith('.')) return null;
  return path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
}

// Module specifiers in import/export declarations, dynamic import() and vi.mock-style calls.
function specifiersOf(sf) {
  const found = [];
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      found.push({ spec: node.moduleSpecifier.text, node: node.moduleSpecifier });
    } else if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])) {
      const callee = node.expression;
      const isDynamic = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isMock = ts.isPropertyAccessExpression(callee) && /^vi\.(mock|doMock|importActual)$/.test(callee.getText(sf));
      if (isDynamic || isMock) found.push({ spec: node.arguments[0].text, node: node.arguments[0] });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

const violations = [];
const report = (rule, rel, sf, node, detail) => {
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  violations.push({ rule, file: rel, line: line + 1, detail });
};

for (const abs of walk(SRC)) {
  const rel = path.relative(SRC, abs).split(path.sep).join('/');
  if (isTest(rel)) continue;
  const sf = ts.createSourceFile(rel, readFileSync(abs, 'utf8'), ts.ScriptTarget.Latest, true, rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const noExt = stripExt(rel);
  const demoSide = isDemoSide(noExt) || /^features\/demo(\/|$)/.test(noExt);
  const owner = /^features\/([^/]+)\//.exec(rel)?.[1] ?? null;

  for (const { spec, node } of specifiersOf(sf)) {
    const target = resolveSpec(rel, spec);
    if (target === null) continue;
    const targetNoExt = target.replace(/\.(ts|tsx)$/, '');
    if (isPresentation(rel) && /^real\//.test(targetNoExt)) report('presentation-imports-real', rel, sf, node, targetNoExt);
    if (!demoSide && isDemoSide(targetNoExt)) report('production-imports-demo', rel, sf, node, targetNoExt);
    if (/^real\//.test(rel) && /^features\//.test(targetNoExt)) report('real-imports-features', rel, sf, node, targetNoExt);
    if (/^real\//.test(rel) && /^screens\//.test(targetNoExt)) report('real-imports-screens', rel, sf, node, targetNoExt);
    if (/^features\//.test(rel) && /^screens\//.test(targetNoExt)) report('features-import-screens', rel, sf, node, targetNoExt);
    const deep = /^features\/([^/]+)\/(.+)$/.exec(targetNoExt);
    if (deep && deep[1] !== owner && deep[2] !== 'index') report('deep-feature-import', rel, sf, node, targetNoExt);
  }

  if (isPresentation(rel)) {
    const visit = (node) => {
      if (ts.isIdentifier(node) && MOCK_PLUMBING.has(node.text)) report('presentation-mock-plumbing', rel, sf, node, node.text);
      if (ts.isPropertyAccessExpression(node) && node.name.text === 'authority') report('presentation-mock-plumbing', rel, sf, node.name, '.authority');
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
}

const counts = {};
for (const v of violations) counts[v.rule] = (counts[v.rule] ?? 0) + 1;
if (asJson) {
  console.log(JSON.stringify({ total: violations.length, counts, violations }, null, 2));
} else {
  console.log(`check-boundaries: ${violations.length} violation(s)`);
  for (const [rule, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${rule}`);
}
if (strict && violations.length > 0) process.exit(1);
