// Checks the web module boundaries of apps/web/src (ADR-0096). Read-only; uses the TypeScript AST.
// Usage: node tools/check-boundaries.mjs [--strict] [--json] [--write-baseline]
//   default: prints the count per rule and its change against tools/boundaries-baseline.json
//   --strict: exits 1 when a rule has more violations than its baseline (a ratchet: counts may go down)
//   --write-baseline: records the current counts as the baseline, after a reviewed reduction
//
// Exceptions (ADR-0096 decisions 2 and 4):
// - demo side (demo/** and features/<x>/mock.ts) may import demo and mock modules at runtime;
// - the composition root (state/services.tsx) may import demo at runtime: it is the one place that chooses mock or real;
// - type-only imports of demo are counted apart (production-type-imports-demo): they are debt to move into domain/.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..', 'src');
const BASELINE = path.join(here, 'boundaries-baseline.json');
const strict = process.argv.includes('--strict');
const asJson = process.argv.includes('--json');
const writeBaseline = process.argv.includes('--write-baseline');

const RULES = [
  'production-imports-demo',
  'production-type-imports-demo',
  'production-imports-composition',
  'presentation-imports-real',
  'presentation-imports-adapter',
  'presentation-mock-plumbing',
  'real-imports-features',
  'real-imports-screens',
  'features-import-screens',
  'deep-feature-import',
];

// Paths below are relative to src, without extension.
const DEMO_SIDE = [/^demo(\/|$)/, /^features\/[^/]+\/mock$/];
const COMPOSITION = [/^state\/services$/, /^App$/, /^main$/];
const MOCK_PLUMBING = new Set(['useServices', 'useServicesOrNull', 'isRealMode', 'DATA_MODE', 'MockClock']);

const stripExt = (rel) => rel.replace(/\.(ts|tsx)$/, '');
const matches = (list, noExt) => list.some((re) => re.test(noExt));
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

// Module specifiers with whether the reference is type-only: import/export declarations, type imports, dynamic import() and vi.mock-style calls.
function specifiersOf(sf) {
  const found = [];
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = ts.isImportDeclaration(node) ? node.importClause : undefined;
      const named = clause?.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements : [];
      const typeOnly = ts.isImportDeclaration(node)
        ? Boolean(clause?.isTypeOnly) || (named.length > 0 && named.every((el) => el.isTypeOnly))
        : Boolean(node.isTypeOnly);
      found.push({ spec: node.moduleSpecifier.text, node: node.moduleSpecifier, typeOnly });
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      found.push({ spec: node.argument.literal.text, node: node.argument.literal, typeOnly: true });
    } else if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])) {
      const callee = node.expression;
      const isDynamic = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isMock = ts.isPropertyAccessExpression(callee) && /^vi\.(mock|doMock|importActual)$/.test(callee.getText(sf));
      if (isDynamic || isMock) found.push({ spec: node.arguments[0].text, node: node.arguments[0], typeOnly: false });
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
  const demoSide = matches(DEMO_SIDE, noExt);
  const composition = matches(COMPOSITION, noExt);
  const owner = /^features\/([^/]+)\//.exec(rel)?.[1] ?? null;

  for (const { spec, node, typeOnly } of specifiersOf(sf)) {
    const target = resolveSpec(rel, spec);
    if (target === null) continue;
    const targetNoExt = stripExt(target);
    if (isPresentation(rel) && /^real\//.test(targetNoExt)) report('presentation-imports-real', rel, sf, node, targetNoExt);
    if (isPresentation(rel) && /^features\/[^/]+\/(remote|mock)$/.test(targetNoExt)) report('presentation-imports-adapter', rel, sf, node, targetNoExt);
    if (!demoSide && !composition && matches(DEMO_SIDE, targetNoExt)) {
      report(typeOnly ? 'production-type-imports-demo' : 'production-imports-demo', rel, sf, node, targetNoExt);
    }
    if (!demoSide && !composition && matches(COMPOSITION, targetNoExt)) report('production-imports-composition', rel, sf, node, targetNoExt);
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

const counts = Object.fromEntries(RULES.map((rule) => [rule, 0]));
for (const v of violations) counts[v.rule] = (counts[v.rule] ?? 0) + 1;
const total = violations.length;
const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')).rules : {};
const over = RULES.filter((rule) => counts[rule] > (baseline[rule] ?? 0));
const under = RULES.filter((rule) => counts[rule] < (baseline[rule] ?? 0));

if (asJson) {
  console.log(JSON.stringify({ total, counts, baseline, over, violations }, null, 2));
} else {
  console.log(`check-boundaries: ${total} violation(s)`);
  for (const rule of RULES) console.log(`  ${String(counts[rule]).padStart(4)}  ${rule}  (baseline ${baseline[rule] ?? 'none'})`);
  if (over.length > 0) console.log(`over baseline: ${over.join(', ')}`);
  if (under.length > 0) console.log(`below baseline (lock with --write-baseline): ${under.join(', ')}`);
}
if (writeBaseline) {
  writeFileSync(BASELINE, `${JSON.stringify({ rules: counts }, null, 2)}\n`);
  console.log(`baseline written: ${path.relative(process.cwd(), BASELINE)}`);
}
if (strict && over.length > 0) process.exit(1);
