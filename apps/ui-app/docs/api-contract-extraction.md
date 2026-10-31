# API contract extraction recipe

This executable documentation generates the four contract reports from local
TypeScript sources. It uses the installed TypeScript compiler and Zod, without
installing dependencies, contacting a backend, or changing application files.
Run from `ui-app` with Node 22.12 or newer. The recipe deliberately retains raw
source evidence alongside structural schemas: compiler inference is not server
validation, and a permissive mock is not an authoritative production contract.

The generated JSON-formatted `openapi.yaml` is valid YAML 1.2. JSON formatting
keeps schema values and escaping lossless. Unresolved schema leaves are annotated
`UNKNOWN`; they are not presented as confirmed arbitrary-JSON contracts.

Re-run from PowerShell (set `CONTRACT_INSPECT` to `1` for inventory-only output).
The Node 24 runtime available for this extraction supplies `registerHooks`;
the application itself still has its separate Node >=22.12 requirement.

```powershell
$env:CONTRACT_INSPECT = '0'; 'import fs from "node:fs"; const doc=fs.readFileSync("docs/api-contract-extraction.md","utf8"); let source=doc.slice(doc.indexOf("\n```js\n")+7,doc.lastIndexOf("\n```")); for(const name of ["typescript","zod"]) source=source.replace("from ''"+name+"''", "from ''"+import.meta.resolve(name)+"''"); await import("data:text/javascript;base64,"+Buffer.from(source).toString("base64"));' | node --input-type=module
```

```js
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { z } from 'zod';

const root = process.cwd();
const rel = p => path.relative(root, p).replaceAll('\\', '/');
const configFile = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root);
const program = ts.createProgram(config.fileNames, config.options);
const checker = program.getTypeChecker();
const sources = program.getSourceFiles().filter(f => rel(f.fileName).startsWith('src/') && !/\.(test|spec)\.ts$/.test(f.fileName));
const sourceByPath = new Map(sources.map(f => [rel(f.fileName), f]));
const loc = n => `${rel(n.getSourceFile().fileName)}:${n.getSourceFile().getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
function walk(n, visit) { visit(n); ts.forEachChild(n, child => walk(child, visit)); }
function text(n) { return n?.getText() ?? ''; }
function declaration(n) {
  let s = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(n) ? n.name : n);
  if (s?.flags & ts.SymbolFlags.Alias) s = checker.getAliasedSymbol(s);
  return s?.valueDeclaration ?? s?.declarations?.[0];
}
function prop(n, name) {
  if (!n) return;
  if (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isSatisfiesExpression(n)) return prop(n.expression, name);
  if (ts.isObjectLiteralExpression(n)) {
    const p = n.properties.find(p => text(p.name).replaceAll(/['"]/g, '') === name);
    if (p) return ts.isPropertyAssignment(p) ? p.initializer : ts.isShorthandPropertyAssignment(p) ? p.name : undefined;
    for (const s of n.properties.filter(ts.isSpreadAssignment)) { const v = prop(s.expression, name); if (v) return v; }
  }
  const d = declaration(n);
  if (d?.initializer && d.initializer !== n) return prop(d.initializer, name);
}
function enclosing(n) {
  for (let p = n.parent; p; p = p.parent) {
    if (ts.isFunctionLike(p)) return text(p.name) || text(p.parent?.name) || '<callback>';
  }
  return '<module>';
}
const unknown = reason => ({ description: `UNKNOWN: ${reason}`, 'x-evidence': 'unknown' });
const components = {};
const typeCache = new Map();
let seq = 0;
function typeSchema(type, depth = 0) {
  if (!type) return unknown('no TypeScript type');
  if (depth > 18) return unknown('type expansion depth limit; inspect cited declaration');
  const F = ts.TypeFlags;
  if (type.flags & (F.Any | F.Unknown | F.TypeParameter)) return unknown('unconstrained TypeScript value');
  if (type.flags & (F.Undefined | F.Void | F.Never)) return unknown('undefined/void/never is not a JSON value');
  if (type.flags & F.Null) return { type: 'null' };
  if (type.flags & F.StringLiteral) return { type: 'string', const: type.value };
  if (type.flags & F.NumberLiteral) return { type: 'number', const: type.value };
  if (type.flags & F.BooleanLiteral) return { type: 'boolean', const: type.intrinsicName === 'true' };
  if (type.flags & F.StringLike) return { type: 'string' };
  if (type.flags & F.NumberLike) return { type: 'number' };
  if (type.flags & F.Boolean) return { type: 'boolean' };
  if (type.isUnion()) {
    const parts = type.types.filter(t => !(t.flags & (F.Undefined | F.Never | F.Void)));
    const schemas = [...new Map(parts.map(t => { const s = typeSchema(t, depth + 1); return [JSON.stringify(s), s]; })).values()];
    return schemas.length === 1 ? schemas[0] : schemas.length ? { anyOf: schemas } : unknown('no JSON union member');
  }
  if (checker.isArrayType(type) || checker.isTupleType(type)) {
    const args = checker.getTypeArguments(type);
    return { type: 'array', items: args.length === 1 ? typeSchema(args[0], depth + 1) : { anyOf: args.map(t => typeSchema(t, depth + 1)) } };
  }
  const label = type.aliasSymbol?.name ?? type.symbol?.name ?? '';
  const declarations = type.symbol?.declarations ?? [];
  if (declarations.length && declarations.every(d => !rel(d.getSourceFile().fileName).startsWith('src/')) && !['__type','__object','Array','ReadonlyArray','Record','Partial','Pick','Omit','Readonly','Required'].includes(label)) return unknown(`non-wire/library type ${label}; not a JSON DTO`);
  if (['File', 'Blob', 'FormData', 'Response', 'Request', 'ReadableStream', 'AbortSignal', 'Date', 'Map', 'Set'].includes(label)) {
    if (label === 'Blob' || label === 'File') return { type: 'string', format: 'binary' };
    return unknown(`non-JSON ${label}; transport/serialization must be inspected`);
  }
  if (typeCache.has(type)) return { $ref: '#/components/schemas/' + typeCache.get(type) };
  const properties = checker.getPropertiesOfType(type).filter(p => !p.name.startsWith('__@'));
  const index = checker.getIndexTypeOfType(type, ts.IndexKind.String);
  if (!properties.length && !index) return type.getCallSignatures().length ? unknown('function, not a wire DTO') : { type: 'object', additionalProperties: true };
  const name = `T${++seq}_${label.replace(/[^a-zA-Z0-9_]/g, '') || 'Object'}`;
  typeCache.set(type, name);
  const shape = { type: 'object', properties: {}, additionalProperties: index ? typeSchema(index, depth + 1) : true, 'x-evidence': 'typescript-inferred' };
  components[name] = shape;
  const required = [];
  for (const p of properties) {
    const d = p.valueDeclaration ?? p.declarations?.[0];
    if (d && (ts.isMethodSignature(d) || ts.isMethodDeclaration(d))) continue;
    const pt = checker.getTypeOfSymbolAtLocation(p, d ?? sources[0]);
    shape.properties[p.name] = typeSchema(pt, depth + 1);
    if (!(p.flags & ts.SymbolFlags.Optional) && !(pt.isUnion() && pt.types.some(t => t.flags & F.Undefined))) required.push(p.name);
  }
  if (required.length) shape.required = required;
  const d = type.aliasSymbol?.declarations?.[0] ?? type.symbol?.declarations?.[0];
  if (d && rel(d.getSourceFile().fileName).startsWith('src/')) shape['x-source'] = loc(d);
  return { $ref: '#/components/schemas/' + name };
}
const schemaAt = n => n ? typeSchema(checker.getTypeAtLocation(n)) : unknown('no body definition');
const combine = a => {
  a = [...new Map(a.filter(Boolean).map(s => [JSON.stringify(s), s])).values()];
  return a.length === 1 ? a[0] : a.length ? { anyOf: a } : unknown('no resolved definition');
};
const uniq = a => [...new Set(a)];
function values(n, env = new Map(), seen = new Set(), depth = 0) {
  if (!n || depth > 15 || seen.has(n)) return [];
  seen = new Set(seen); seen.add(n);
  const next = v => values(v, env, seen, depth + 1);
  if (ts.isStringLiteralLike(n)) return [n.text];
  if (ts.isNumericLiteral(n)) return [n.text];
  if (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isSatisfiesExpression(n) || ts.isAwaitExpression(n)) return next(n.expression);
  if (ts.isConditionalExpression(n)) return uniq([...next(n.whenTrue), ...next(n.whenFalse)]);
  if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return next(n.left).flatMap(a => next(n.right).map(b => a + b)).slice(0, 128);
  }
  if (ts.isTemplateExpression(n)) {
    let out = [n.head.text];
    for (const s of n.templateSpans) out = out.flatMap(a => next(s.expression).map(b => a + b + s.literal.text)).slice(0, 128);
    return out;
  }
  if (ts.isIdentifier(n) && env.has(n.text)) return values(env.get(n.text), new Map(), seen, depth + 1);
  if (ts.isCallExpression(n)) {
    const fn = text(n.expression);
    if (fn === 'encodeURIComponent' || fn === 'String') return next(n.arguments[0]);
    if (/agentEndpoint|resolveAgentEndpoint/.test(fn)) return ['/api/eino-agent/stream', '/api/multi-agent/stream', ...(text(n.arguments[1]) === 'false' ? ['/api/eino-agent', '/api/multi-agent'] : [])].filter(p => text(n.arguments[1]) !== 'false' || !p.endsWith('/stream'));
    let d = declaration(n.expression);
    if (d?.initializer && ts.isArrowFunction(d.initializer)) d = d.initializer;
    if (d && ts.isFunctionLike(d) && d.body) {
      const inner = new Map(env);
      d.parameters.forEach((p, i) => { if (ts.isIdentifier(p.name) && n.arguments[i]) inner.set(p.name.text, n.arguments[i]); });
      const returns = ts.isBlock(d.body) ? d.body.statements.filter(ts.isReturnStatement).map(s => s.expression) : [d.body];
      return uniq(returns.flatMap(r => values(r, inner, seen, depth + 1)));
    }
  }
  const d = declaration(n);
  if (d?.initializer && !ts.isParameter(d) && d.initializer !== n) {
    const result = next(d.initializer); if (result.length) return result;
  }
  const t = checker.getTypeAtLocation(n);
  if (t.isUnion() && t.types.every(t => t.flags & ts.TypeFlags.StringLiteral)) return t.types.map(t => t.value);
  if (t.flags & ts.TypeFlags.StringLiteral) return [t.value];
  return ['{' + (text(n).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 40) || 'value') + '}'];
}
function norm(p) { return p.split('?')[0].split('#')[0].replace(/:([a-zA-Z0-9_]+)/g, '{$1}').replace(/\/$/, ''); }
const structural = p => norm(p).replace(/\{[^}]+\}/g, '{}');
const ops = new Map();
function operation(method, p) {
  p = norm(p);
  const key = method + ' ' + structural(p);
  if (!ops.has(key)) ops.set(key, { method, path: p, front: [], mocks: [], params: [], requests: [], responses: [], errors: [], snippets: [], notes: [], protocol: 'http' });
  return ops.get(key);
}
function returnCalls(handler, seen = new Set(), depth = 0) {
  if (!handler || depth > 8 || seen.has(handler)) return [];
  seen.add(handler);
  let returns = [];
  function visit(n) {
    if (n !== handler && ts.isFunctionLike(n)) return;
    if (ts.isReturnStatement(n) && n.expression) returns.push(n.expression);
    else ts.forEachChild(n, visit);
  }
  if (ts.isFunctionLike(handler) && handler.body && !ts.isBlock(handler.body)) returns.push(handler.body);
  else visit(handler.body ?? handler);
  return returns.flatMap(n => {
    if (ts.isConditionalExpression(n)) return [n.whenTrue, n.whenFalse].flatMap(n => returnExpression(n));
    return returnExpression(n);
  });
  function returnExpression(n) {
    if (!n) return [];
    if (ts.isConditionalExpression(n)) return [n.whenTrue, n.whenFalse].flatMap(returnExpression);
    if (ts.isCallExpression(n)) {
      if (/^M\.(ok|json|fail|blob|sse)$/.test(text(n.expression))) return [n];
      let d = declaration(n.expression);
      if (d?.initializer && ts.isFunctionLike(d.initializer)) d = d.initializer;
      if (d && ts.isFunctionLike(d)) return returnCalls(d, seen, depth + 1);
    }
    return [];
  }
}
const mockNodes = [];
for (const f of sources.filter(f => rel(f.fileName).startsWith('src/mock/routes/'))) walk(f, n => {
  if (!ts.isCallExpression(n) || text(n.expression) !== 'M.route') return;
  const method = values(n.arguments[0])[0], p = values(n.arguments[1])[0];
  const op = operation(method, p), handler = n.arguments.at(-1);
  op.mocks.push({ source: loc(n), function: enclosing(n), schema: n.arguments.length === 4 ? text(n.arguments[2]) : null });
  op.snippets.push({ source: loc(n), kind: 'mock-handler', code: text(n) });
  mockNodes.push({ op, node: n });
  for (const call of returnCalls(handler)) {
    const kind = text(call.expression).slice(2), args = call.arguments;
    if (kind === 'fail') { op.errors.push({ status: values(args[0])[0], message: text(args[1]), source: loc(call) }); continue; }
    if (kind === 'sse') { op.protocol = 'sse'; op.responses.push({ status: '200', source: loc(call), media: 'text/event-stream', schema: { type: 'string', description: 'SSE wire stream; see realtime-api-contracts.md' } }); continue; }
    if (kind === 'blob') {
      const media=args[1]&&ts.isStringLiteralLike(args[1])?args[1].text:'application/octet-stream';
      let schema={type:'string',format:'binary'};
      if(media==='application/json'&&args[0]&&ts.isCallExpression(args[0])&&text(args[0].expression)==='JSON.stringify')schema=schemaAt(args[0].arguments[0]);
      else if(media==='application/json'&&args[0]&&ts.isStringLiteralLike(args[0])){
        try{const value=JSON.parse(args[0].text);schema={const:value,description:'Exact JSON fixture literal in mock blob response'};}catch{schema=unknown('invalid JSON fixture bytes; inspect producer');}
      }
      op.responses.push({status:'200',source:loc(call),media,schema,exampleExpression:text(args[0])});continue;
    }
    op.responses.push({ status: kind === 'json' ? values(args[0])[0] : '200', source: loc(call), media: 'application/json', schema: kind === 'ok' && !args.length ? { type: 'object', properties: { success: { const: true } }, required: ['success'] } : schemaAt(args[kind === 'json' ? 1 : 0]), exampleExpression: text(args[kind === 'json' ? 1 : 0]) });
  }
  if (n.arguments.length === 4) op.errors.push({ status: '400', message: 'Invalid request body', source: 'src/mock/router.ts:48' });
  // These are actual mock parameter reads, not backend validation guarantees.
  walk(handler, child => {
    if (!ts.isCallExpression(child)) return;
    const e = text(child.expression);
    if ((/\.query\.get$/.test(e) || /\bq\.get$/.test(e)) && child.arguments[0] && ts.isStringLiteralLike(child.arguments[0])) op.params.push({ name: child.arguments[0].text, in: 'query', schema: { type: 'string' }, source: loc(child), basis: 'mock-read' });
    if (/^M\.q(Int)?$/.test(e) && child.arguments[1] && ts.isStringLiteralLike(child.arguments[1])) op.params.push({ name: child.arguments[1].text, in: 'query', schema: { type: e.endsWith('Int') ? 'integer' : 'string', ...(child.arguments[2] && (ts.isStringLiteralLike(child.arguments[2])||ts.isNumericLiteral(child.arguments[2])) ? { default: ts.isNumericLiteral(child.arguments[2])?Number(child.arguments[2].text):child.arguments[2].text } : {}) }, source: loc(child), basis: 'mock-read (default is mock-only)' });
  });
});

// Detect concrete transport calls, including method/path helpers and union actions.
const callCandidates = [], unresolved = [];
for (const f of sources.filter(f => !rel(f.fileName).startsWith('src/mock/'))) walk(f, n => {
  if (!ts.isCallExpression(n) && !ts.isNewExpression(n)) return;
  const fn = text(n.expression), args = n.arguments ?? [];
  if (!/(?:request|fetch|apiFetch|apiGet|apiPost|getJson|\bapi|\bjson|\bget|\bpost|\bput|\bpatch|\bdel|\bsend|\bdownload|\.get|\.post|\.put|\.patch|\.delete|\.raw|\.run|\.send|\.upload|EventSource|WebSocket)/i.test(fn)) return;
  if (/\.route$/.test(fn) || /^(?:encodeURIComponent|JSON\.)/.test(fn)) return;
  let pathIndex = 0;
  if (args[0] && values(args[0]).every(v => /^(GET|POST|PUT|DELETE|PATCH)$/.test(v))) pathIndex = 1;
  let urls = values(args[pathIndex]).filter(v => v.startsWith('/api/'));
  if (!urls.length) return;
  // Helpers constructing paths are not operations on their own.
  if (/^(?:path|connectionPath|resourcePath|itemPath|base|agentEndpoint|resolveAgentEndpoint)$/.test(fn)) return;
  let methods = ['GET'], body, opts = args[pathIndex + 1];
  const suffix = fn.split('.').at(-1)?.toLowerCase();
  if (['get', 'post', 'put', 'patch', 'delete'].includes(suffix)) {
    methods = [suffix.toUpperCase()];
    if (['post', 'put', 'patch'].includes(suffix)) { body = opts; opts = args[pathIndex + 2]; }
  } else if (pathIndex === 1) { methods = values(args[0]); body = args[2]; opts = undefined; }
  else if (['post', 'jsonBody'].includes(fn)) { methods = args[2] ? values(args[2]) : ['POST']; body = args[1]; opts = undefined; }
  else {
    if (args[pathIndex + 2] && prop(args[pathIndex + 2], 'method')) opts = args[pathIndex + 2];
    let methodNode = prop(opts, 'method');
    body = prop(opts, 'body');
    if (methodNode) methods = values(methodNode);
    else if (ts.isCallExpression(opts ?? n) && /body|write|jsonBody/.test(text(opts?.expression))) { methods = values(opts.arguments[0]); body = opts.arguments[1]; }
    else if (opts && values(opts).every(v => /^(GET|POST|PUT|DELETE|PATCH)$/.test(v))) { methods = values(opts); body = args[pathIndex + 2]; }
    if (opts && ts.isObjectLiteralExpression(opts)) for (const spread of opts.properties.filter(ts.isSpreadAssignment)) {
      const c = spread.expression;
      if (ts.isCallExpression(c) && /body|write|jsonBody/i.test(text(c.expression))) { methods = values(c.arguments[0]); body = c.arguments[1]; }
    }
  }
  if (ts.isCallExpression(body ?? n) && text(body?.expression) === 'JSON.stringify') body = body.arguments[0];
  if (fn === 'post' && args[2]) methods = values(args[2]);
  methods = methods.filter(m => /^(GET|POST|PUT|DELETE|PATCH)$/.test(m));
  if (!methods.length) { unresolved.push({ source: loc(n), code: text(n), reason: 'dynamic method' }); return; }
  for (const url of uniq(urls)) for (const method of methods) {
    if (/^\/api\/.*\{[^}]+\}$/.test(norm(url)) && /\{(?:path|url|address|kind)\}/.test(norm(url))) { unresolved.push({ source: loc(n), code: text(n), reason: 'dynamic URL helper; explicit expansion required' }); continue; }
    const op = operation(method, url);
    op.front.push({ source: loc(n), function: enclosing(n), expression: text(n) });
    if (body && text(body) !== 'undefined') op.requests.push({ source: loc(body), function: enclosing(n), schema: schemaAt(body), expression: text(body), basis: 'frontend-request' });
    const t = checker.getTypeAtLocation(n), awaited = checker.getAwaitedType(t) ?? t;
    if (!['Response', 'unknown', 'void', 'Promise<Response>'].includes(checker.typeToString(awaited)) && !ts.isNewExpression(n)) op.front.at(-1).responseSchema = typeSchema(awaited);
    if (n.typeArguments?.[0]) op.front.at(-1).genericResponse = schemaAt(n.typeArguments[0]);
    // Resolve consumer assertions/decoder outputs around this request or its
    // assigned Response. Keep these views separate: defaults can normalize wire
    // data, so a consumer model must not replace a mock wire schema.
    const views=[];
    let cursor=n, assigned;
    for(let i=0;cursor.parent&&i<7;i++,cursor=cursor.parent){
      const p=cursor.parent;
      if(ts.isAsExpression(p))views.push({source:loc(p),basis:'frontend-type-assertion',schema:schemaAt(p.type)});
      if(ts.isCallExpression(p)&&/\.parse$/.test(text(p.expression)))views.push({source:loc(p),basis:'frontend-decoder-output (may contain defaults/transforms)',schema:schemaAt(p)});
      if(ts.isVariableDeclaration(p)){assigned=p;break;}
      if(ts.isStatement(p))break;
    }
    if(assigned&&ts.isIdentifier(assigned.name)){
      const symbol=checker.getSymbolAtLocation(assigned.name);
      let scope=assigned.parent;
      while(scope.parent&&!ts.isFunctionLike(scope)&&!ts.isSourceFile(scope))scope=scope.parent;
      walk(scope,child=>{
        if(!ts.isAsExpression(child)&&!(ts.isCallExpression(child)&&/\.(?:parse|safeParse)$/.test(text(child.expression))))return;
        let uses=false;
        walk(child,part=>{if(ts.isIdentifier(part)&&checker.getSymbolAtLocation(part)===symbol)uses=true;});
        if(uses&&!/safeParse$/.test(text(child.expression)))views.push({source:loc(child),basis:ts.isAsExpression(child)?'frontend-type-assertion':'frontend-decoder-output (may contain defaults/transforms)',schema:ts.isAsExpression(child)?schemaAt(child.type):schemaAt(child)});
      });
    }
    op.front.at(-1).consumerViews=views;
    const parts = url.split('?');
    if (parts[1]) for (const [name, value] of new URLSearchParams(parts[1])) if (!name.includes('{') && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) op.params.push({ name, in: 'query', schema: { type: 'string' }, source: loc(n), basis: 'frontend-url', expression: value });
    const queryNode = prop(opts, 'query');
    if (queryNode) {
      const qt = checker.getTypeAtLocation(queryNode);
      for (const p of checker.getPropertiesOfType(qt)) {
        const d = p.valueDeclaration ?? p.declarations?.[0];
        op.params.push({ name: p.name, in: 'query', schema: typeSchema(checker.getTypeOfSymbolAtLocation(p, d ?? queryNode)), source: d ? loc(d) : loc(queryNode), basis: 'frontend-query-type' });
      }
    }
    const headerNode = prop(opts, 'headers');
    if (headerNode && ts.isObjectLiteralExpression(headerNode)) for (const p of headerNode.properties) if (p.name) op.params.push({ name: text(p.name).replaceAll(/['"]/g, ''), in: 'header', schema: { type: 'string' }, source: loc(p), basis: 'frontend-header' });
    callCandidates.push({ op, node: n });
  }
});

// Import only pure schemas and mock registrations. No browser startup is run.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('@/')) specifier = pathToFileURL(path.join(root, 'src', specifier.slice(2)) + '.ts').href;
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      const p = fileURLToPath(new URL(specifier, context.parentURL));
      for (const candidate of [p, p + '.ts', path.join(p, 'index.ts')]) if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return { url: pathToFileURL(candidate).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith('.json')) return { format: 'module', source: 'export default ' + fs.readFileSync(fileURLToPath(url), 'utf8'), shortCircuit: true };
    if (url.endsWith('.ts')) return { format: 'module', source: ts.transpileModule(fs.readFileSync(fileURLToPath(url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText, shortCircuit: true };
    return next(url, context);
  },
});
const load = p => import(pathToFileURL(path.join(root, p)).href);
const { bodies } = await load('src/mock/bodies.ts');
const { MockRuntime } = await load('src/mock/runtime.ts');
const register = [];
for (const [file, fn] of [['auth', 'registerAuth'], ['chat', 'registerChat'], ['security', 'registerSecurity'], ['platform', 'registerPlatform']]) register.push((await load(`src/mock/routes/${file}.ts`))[fn]);
const fresh = () => { const runtime = new MockRuntime(undefined, true, 0); register.forEach(fn => fn(runtime)); return runtime; };
const runtime = fresh();
const zodComponents = {};
function zodSchema(schema, name, source) {
  if (zodComponents[name]) return { $ref: '#/components/schemas/' + name };
  let shape;
  try { shape = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any', cycles: 'ref', reused: 'inline' }); }
  catch (e) { shape = unknown('Zod conversion: ' + e.message); }
  if (shape.$defs) {
    shape = JSON.parse(JSON.stringify(shape).replaceAll('#/$defs/', '#/components/schemas/' + name + '_'));
    for (const [key, value] of Object.entries(shape.$defs)) components[name + '_' + key] = value;
    delete shape.$defs;
  }
  delete shape.$schema;
  shape['x-source'] = source;
  shape['x-evidence'] = 'explicit-zod-input';
  // Empty conversion nodes are unknown, not confirmed generic JSON acceptance.
  function annotate(s) {
    if (!s || typeof s !== 'object') return;
    if (!Array.isArray(s) && Object.keys(s).length === 0) Object.assign(s, unknown('unrepresentable Zod transform/unknown/instance; see source'));
    else {
      for (const v of Object.values(s.properties ?? {})) annotate(v);
      for (const key of ['items','additionalProperties','not']) if (s[key] && typeof s[key] === 'object') annotate(s[key]);
      for (const key of ['anyOf','oneOf','allOf','prefixItems']) for (const v of s[key] ?? []) annotate(v);
    }
  }
  annotate(shape);
  components[name] = shape; zodComponents[name] = true;
  return { $ref: '#/components/schemas/' + name };
}
for (const [name, schema] of Object.entries(bodies)) zodSchema(schema, 'MockBody_' + name, 'src/mock/bodies.ts');
for (const p of ['src/api/types/common.ts', 'src/api/types/auth.ts', 'src/api/types/asset.ts', 'src/api/types/conversation.ts', 'src/api/types/project.ts', 'src/api/types/vulnerability.ts', 'src/api/types/chat.ts', 'src/mock/types.ts', 'src/features/workflows/model.ts', 'src/features/tasks/model.ts']) {
  const module = await load(p);
  for (const [name, value] of Object.entries(module)) if (name.endsWith('Schema') && value && typeof value.safeParse === 'function') zodSchema(value, rel(p).replace(/[^a-zA-Z0-9]/g, '_') + '_' + name, p);
}
for (const { op, node } of mockNodes) if (node.arguments.length === 4) {
  const name = text(node.arguments[2]);
  if (name.startsWith('bodies.')) op.mockRequest = { $ref: '#/components/schemas/MockBody_' + name.slice(7) };
  else if (name.includes('approved')) op.mockRequest = { type: 'object', properties: { approved: { type: 'boolean' }, comment: { type: 'string' } }, required: ['approved'], additionalProperties: false };
}

// Manual expansions are grounded in wrapper call sites, not the older catalog.
const additions = [
  ['POST','/api/robot/wechat/qrcode','src/features/wechat-robot/client.ts',14],
  ['GET','/api/robot/wechat/qrcode/status','src/features/wechat-robot/client.ts',15],
  ['POST','/api/robot/wechat/qrcode/verify','src/features/wechat-robot/client.ts',16],
  ['GET','/api/system/update','src/features/update/service.ts',37],
  ['GET','/api/system/update/job','src/features/update/service.ts',103],
  ...Object.entries({check:140,apply:161,restart:171,rollback:180,adopt:201,source:191}).map(([a,line]) => ['POST','/api/system/update/'+a,'src/features/update/service.ts',line]),
  ...['sessions','tasks','events'].map(a=>['DELETE','/api/c2/'+a,'src/features/c2/service.ts',143]),
  ['GET','/api/c2/events/stream','src/platform/access-browser.ts',68],
  ['GET','/api/c2/tasks/{id}/result-file','src/features/c2/service.ts',296],
  ['POST','/api/c2/files/upload','src/features/c2/service.ts',198],
];
for (const [method, p, file, line] of additions) {
  const op = operation(method, p), f = sourceByPath.get(file);
  if (!f) throw new Error('Missing manual source ' + file);
  op.front.push({ source: file + (line ? ':' + line : ''), function: '<wrapper expansion>', expression: line ? f.text.split('\n')[line-1] : f.text });
}

// Earlier list is a reconciliation input ONLY; never create contracts from it.
const baseline = fs.readFileSync('docs/ui-api-endpoints.md', 'utf8');
let group = '', oldRows = [];
for (const line of baseline.split('\n')) {
  if (/^## \d+\./.test(line)) group = line.replace(/^## \d+\. /, '');
  const match = /^\| `(GET|POST|PUT|PATCH|DELETE|WS) (\/api\/[^`]+)` \|([^|]*)\|([^|]*)\|([^|]*)\|/.exec(line);
  if (match) oldRows.push({ method: match[1], path: norm(match[2]), purpose: match[3].trim(), query: match[4].trim(), body: match[5].trim(), group });
}
for (const op of ops.values()) {
  const old = oldRows.find(r => r.method === op.method && structural(r.path) === structural(op.path));
    op.group = old?.group ?? ({'batch-tasks':'Batch task queues',workflows:'Workflows and packages'}[op.path.split('/')[2]] ?? op.path.split('/')[2]);
    if(old)op.path=old.path;
  op.purpose = old?.purpose.replace(/; (?:mock-only|client-only|mock registration).*$/i, '') ?? `${op.method} ${op.path}`;
  op.previous = old;
  if (old) {
    // Aids query completeness; carries explicitly historical/secondary evidence.
    for (const code of old.query.matchAll(/`([a-zA-Z_][a-zA-Z0-9_]*)(?:=[^`]*)?`/g)) if (!op.params.some(p => p.name === code[1] && p.in === 'query')) op.params.push({ name: code[1], in: 'query', schema: { type: 'string', description: 'Wire query value; optionality/server parsing UNKNOWN' }, source: 'docs/ui-api-endpoints.md (cross-reference; verify cited caller)', basis: 'prior-inventory' });
  }
}

// Remove obvious non-operation artifacts produced by URL-valued helper functions.
for (const [key, op] of ops) if (!op.mocks.length && op.front.every(e => /(?:^|\.)(?:getItem|set|get|download|scoped|path|resourcePath|connectionPath|itemPath)$/.test(e.expression.split('(')[0])) && !op.previous) ops.delete(key);
// Conditional URL/method pairs are correlated in the caller; a Cartesian
// expansion creates impossible combinations. Confirm each exclusion in source.
const excludedArtifacts = [];
const correlated = new Set([
  'POST /api/c2/listeners/{}','PUT /api/c2/listeners',
  'DELETE /api/c2/listeners/{}/start','DELETE /api/c2/listeners/{}/stop',
  'GET /api/c2/files/upload','POST /api/c2/profiles/{}','PUT /api/c2/profiles',
  'POST /api/knowledge/items/{}','PUT /api/knowledge/items',
  'POST /api/roles/{}','PUT /api/roles','PUT /api/workflows','POST /api/workflows/{}',
  'POST /api/batch-tasks/{}/tasks/{}','PUT /api/batch-tasks/{}/tasks',
  'POST /api/system/update','POST /api/webshell/connections/{}','PUT /api/webshell/connections',
]);
for (const [key, op] of ops) if (!op.mocks.length && (correlated.has(key) || op.path.includes('&project_id='))) {
  excludedArtifacts.push({ key, reason: 'conditional method/path correlation or query delimiter; not a real operation', sources: op.front.map(e=>e.source) }); ops.delete(key);
}
const unresolvedBaseline = oldRows.filter(r => r.method !== 'WS' && !ops.has(r.method + ' ' + structural(r.path)));
if (process.env.CONTRACT_INSPECT === '1') {
  console.log(JSON.stringify({ oldRows:oldRows.length, mockRegistrations: runtime.routes.length, operations: ops.size, mockOnly:[...ops.values()].filter(o=>!o.front.length).map(o=>o.method+' '+o.path), missingBaseline: unresolvedBaseline, nonBaseline: [...ops.values()].filter(o=>!o.previous).map(o=>({method:o.method,path:o.path,front:o.front.map(f=>f.source)})), unresolved }, null, 2));
} else {
  await publish();
}

async function publish() {
  const object = (properties, required = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: true });
  const str = { type: 'string' }, bool = { type: 'boolean' }, num = { type: 'number' }, stringArray = { type: 'array', items: str };
  const getOp = (method,p) => ops.get(method+' '+structural(p));
  getOp('GET','/api/batch-tasks/runs').purpose='List recorded batch execution runs';
  getOp('GET','/api/workflows/runs').purpose='List workflow execution runs';
  for(const [file,name,targets]of [
    ['src/features/update/types.ts','UpdateResponse',[...ops.values()].filter(o=>o.path.startsWith('/api/system/update'))],
    ['src/features/wechat-robot/types.ts','WechatResponse',[...ops.values()].filter(o=>o.path.startsWith('/api/robot/wechat/qrcode'))],
  ]){
    const f=sourceByPath.get(file),decl=f.statements.find(n=>(ts.isInterfaceDeclaration(n)||ts.isTypeAliasDeclaration(n))&&text(n.name)===name);
    if(!decl)throw new Error('Missing response type '+file+' '+name);
    for(const op of targets)op.front.push({source:loc(decl),function:'typed-wrapper-result',expression:text(decl),responseSchema:schemaAt(decl.name)});
  }
  const binary=getOp('GET','/api/c2/tasks/{id}/result-file');
  binary.responseMedia='application/octet-stream';
  binary.front.push({source:'src/features/c2/service.ts:208–215,296',function:'downloadTaskResult',expression:'request(path).blob()',responseSchema:{type:'string',format:'binary'}});
  const supplemental = (method,p,properties,required,source) => {
    const op = getOp(method,p); if (!op) throw new Error('Supplement absent '+method+' '+p);
    op.requests.push({ source, basis: 'source-reviewed-frontend', schema: object(properties,required), expression: 'See cited caller and resolved field schema.' });
  };
  supplemental('POST','/api/robot/wechat/qrcode',{bot_type:str},['bot_type'],'src/features/wechat-robot/client.ts:14');
  supplemental('POST','/api/robot/wechat/qrcode/verify',{session_key:str,verify_code:str},['session_key','verify_code'],'src/features/wechat-robot/client.ts:16');
  supplemental('POST','/api/system/update/apply',{restart:bool},['restart'],'src/features/update/service.ts');
  supplemental('POST','/api/system/update/adopt',{confirm:bool,restart:bool},['confirm'],'src/features/update/service.ts');
  supplemental('POST','/api/system/update/source',{repo:str},['repo'],'src/features/update/service.ts');
  supplemental('POST','/api/agent-loop/cancel',{conversationId:str,reason:str,continueAfter:{type:'boolean',const:true},executionId:str},['conversationId','reason','continueAfter'],'src/features/chat/progress/tasks.ts:49–50');
  for(const [p,props,required]of [
    ['/api/config/test-openai',{provider:str,channel_id:str,base_url:str,api_key:str,model:str,credential_scope:str},[]],
    ['/api/config/test-typesafe',{base_url:str,api_key:str,model:str,credential_scope:{const:'hitlAudit',type:'string'}},['base_url','api_key','model','credential_scope']],
    ['/api/config/test-vision',{vision:object({enabled:bool,provider:str,api_key:str,base_url:str,model:str}),openai:object({provider:str,base_url:str,api_key:str,model:str}),channel_id:str},['vision','openai','channel_id']],
  ])supplemental('POST',p,props,required,'src/features/settings/controller.ts:191–203');
  // Correlate the two skill-edit URL/body branches rather than allowing the
  // package-file payload on the SKILL.md metadata route (or vice versa).
  for(const [p,props,required]of [['/api/skills/{name}',{description:str,content:str},['description','content']],['/api/skills/{name}/file',{path:str,content:str},['path','content']]]){
    getOp('PUT',p).requests=[];supplemental('PUT',p,props,required,'src/features/skills/service.ts:100');
  }
  // The Settings form registry contains real request fields absent from the
  // intentionally open ConfigObject interface and the smaller mock config.
  const { SETTINGS_FIELDS }=await load('src/features/settings/forms.ts');
  const settingsShape=object({});
  for(const field of SETTINGS_FIELDS){
    const parts=field.path.split('.');let cursor=settingsShape;
    for(const part of parts.slice(0,-1))cursor=cursor.properties[part]??=(object({}));
    const shape={type:field.kind==='check'?'boolean':field.kind==='int'?'integer':field.kind==='float'?'number':['list','comma'].includes(field.kind)?'array':'string',default:field.fallback,description:'Frontend form fallback/normalization only; not a server default. '+field.id};
    if(shape.type==='array')shape.items=str;
    if(field.choices)shape.enum=field.choices;
    if(field.min!==undefined)shape.minimum=field.min;
    if(field.max!==undefined)shape.maximum=field.max;
    cursor.properties[parts.at(-1)]=shape;
  }
  const settingsModel=sourceByPath.get('src/features/settings/model.ts');
  const namedSchema=name=>schemaAt(settingsModel.statements.find(n=>(ts.isInterfaceDeclaration(n)||ts.isTypeAliasDeclaration(n))&&text(n.name)===name)?.name);
  settingsShape.properties.ai={allOf:[namedSchema('AIConfig')],description:'Dynamic channel IDs; see AIChannel and Reasoning definitions.'};
  settingsShape.properties.tools={type:'array',items:object({name:str,enabled:bool,is_external:bool,external_mcp:str},['name','enabled','is_external','external_mcp'])};
  settingsShape.properties.multi_agent.properties.tool_search_always_visible_tools=stringArray;
  for(const channel of ['wechat','wecom','dingtalk','lark','telegram','slack','discord','qq'])settingsShape.properties.robots.properties[channel].properties.auth=namedSchema('RobotAuth');
  components.SettingsFormConfig={...settingsShape,'x-source':'src/features/settings/forms.ts:11–55; src/features/settings/service.ts:124–131','x-evidence':'explicit-frontend-form-fields'};
  getOp('PUT','/api/config').requests.push({source:'src/features/settings/forms.ts:11–55; src/features/settings/service.ts:124–131',basis:'source-reviewed-form-registry',schema:{$ref:'#/components/schemas/SettingsFormConfig'},expression:'collect(SETTINGS_FIELDS), ai channels, per-provider auth and tool state'});
  getOp('GET','/api/config').front.push({source:'src/features/settings/forms.ts:11–55',function:'fill',expression:'SETTINGS_FIELDS input values/fallbacks (response consumption, not guaranteed wire presence)',responseSchema:{$ref:'#/components/schemas/SettingsFormConfig'}});
  // Expand known task payload constructions; the open Record contract remains
  // separately visible and these cases are not a closed server task-type enum.
  for(const f of sources.filter(f=>rel(f.fileName).startsWith('src/features/c2/')))walk(f,n=>{
    if(!ts.isCallExpression(n)||!/(?:^|\.)createTask$/.test(text(n.expression))||!n.arguments[1])return;
    const types=values(n.arguments[1]).filter(v=>!v.includes('{'));
    if(!types.length)return;
    for(const type of types)getOp('POST','/api/c2/tasks').requests.push({source:loc(n),basis:'observed-task-payload-case (not exhaustive enum)',schema:object({session_id:str,task_type:{type:'string',const:type},payload:n.arguments[2]?schemaAt(n.arguments[2]):object({})},['session_id','task_type','payload']),expression:text(n)});
  });
  const assetFilters=(await load('src/features/assets/model.ts')).FILTER_FIELDS;
  const vulnFilters=(await load('src/features/vulnerability/model.ts')).emptyFilters();
  for(const p of ['/api/assets','/api/assets/selection'])for(const name of [...Object.values(assetFilters),'first_seen_before','last_seen_before','scan_state','scan_overdue_days','sort_by','sort_order'])getOp('GET',p).params.push({name,in:'query',schema:str,source:'src/features/assets/model.ts:16–23,82–90',basis:'explicit-frontend-filter-map'});
  for(const [method,p]of [['GET','/api/vulnerabilities'],['GET','/api/vulnerabilities/stats'],['GET','/api/vulnerabilities/export'],['DELETE','/api/vulnerabilities/batch']])for(const name of Object.keys(vulnFilters))getOp(method,p).params.push({name,in:'query',schema:str,source:'src/features/vulnerability/model.ts:4–7; src/features/vulnerability/service.ts:12',basis:'explicit-frontend-filter-map'});
  supplemental('DELETE','/api/c2/sessions',{ids:stringArray},['ids'],'src/features/c2/service.ts:143');
  supplemental('DELETE','/api/c2/tasks',{ids:stringArray},['ids'],'src/features/c2/service.ts:143');
  supplemental('DELETE','/api/c2/events',{ids:stringArray},['ids'],'src/features/c2/service.ts:143');
  // Multipart is not JSON. This is a field description, not a JSON upload.
  for (const [p,props,req,source] of [
    ['/api/c2/files/upload',{session_id:str,remote_path:str,file:{type:'string',format:'binary'}},['session_id','remote_path','file'],'src/features/c2/service.ts:193'],
    ['/api/chat-uploads',{file:{type:'array',items:{type:'string',format:'binary'}},conversationId:str,relativeDir:str},['file'],'src/features/chat-files/service.ts:55'],
    ['/api/workflow-package-inspections',{file:{type:'string',format:'binary',description:'Client validates .csapkg.zip and <= 10 MiB'}},['file'],'src/features/workflows/package-client.ts:37'],
  ]) { const op=getOp('POST',p); op.requests=[]; op.requests.push({source,basis:'source-reviewed-multipart',schema:object(props,req),expression:'multipart/form-data (browser supplies boundary)'}); op.requestMedia='multipart/form-data'; }
  // Query fields in wrapper implementations and recently added list operations.
  for (const [method,p,names,source] of [
    ['GET','/api/workflows/runs',['workflowId','status','offset','limit'],'src/features/workflows/service.ts:85'],
    ['GET','/api/batch-tasks/runs',['offset','limit'],'src/features/tasks/service.ts:59'],
    ['GET','/api/c2/events/stream',['token'],'src/platform/access-browser.ts:68'],
    ['GET','/api/robot/wechat/qrcode/status',['session_key'],'src/features/wechat-robot/client.ts:15'],
    ['GET','/api/c2/tasks',['status','task_type','session_id','since','page','page_size','project_id'],'src/features/c2/service.ts:107'],
    ['GET','/api/c2/events',['level','category','session_id','since','page','page_size'],'src/features/c2/service.ts:120'],
    ['GET','/api/config/tools',['page','page_size','search','enabled','external_mcp','refresh_external','include_external'],'src/features/settings/client.ts:17'],
  ]) for (const name of names) getOp(method,p).params.push({name,in:'query',schema:str,source,basis:'source-reviewed-query'});
  for (const { op,node } of mockNodes) {
    const handler=node.arguments.at(-1);
    walk(handler,n=>{
      if (!ts.isCallExpression(n)) return;
      const fn=text(n.expression);
      if (/^M\.(pagePaged|limitOffset|filterList)$/.test(fn)) {
        const names=fn.endsWith('pagePaged')?['page','page_size','pageSize']:fn.endsWith('limitOffset')?['limit','offset']:['search'];
        for(const name of names){
          const sized=n.arguments[2]&&ts.isNumericLiteral(n.arguments[2])?Number(n.arguments[2].text):fn.endsWith('pagePaged')?20:50;
          const schema=name==='search'?str:{type:'integer',default:name==='page'?1:name==='offset'?0:sized};
          op.params.push({name,in:'query',schema,source:loc(n)+'; src/mock/common.ts',basis:'mock-helper (default is mock-only)'});
        }
        if(fn.endsWith('filterList')){
          const filters=prop(n.arguments[2],'filters');
          if(filters&&ts.isObjectLiteralExpression(filters))for(const property of filters.properties)if(ts.isPropertyAssignment(property)&&ts.isStringLiteralLike(property.initializer))op.params.push({name:property.initializer.text,in:'query',schema:str,source:loc(property),basis:'mock-helper-filter'});
        }
      }
    });
  }
  // Corroborate inherited query names against current source declarations. Keep
  // a historical-only flag if a name cannot be independently found.
  for(const op of ops.values())for(const p of op.params.filter(p=>p.basis==='prior-inventory')){
    const files=uniq([...op.front.map(f=>f.source.split(':')[0]),...op.mocks.map(f=>f.source.split(':')[0])]);
    const candidates=files.flatMap(file=>{const dir=path.posix.dirname(file);return [file,dir+'/model.ts',dir+'/types.ts',...sources.filter(f=>rel(f.fileName).startsWith('src/api/types/')).map(f=>rel(f.fileName))];});
    let found;
    for(const file of uniq(candidates)){
      const f=sourceByPath.get(file);if(!f)continue;
      walk(f,n=>{if(!found&&((ts.isStringLiteralLike(n)&&n.text===p.name)||(n.name&&text(n.name)===p.name)))found=n;});
      if(found)break;
    }
    if(found){p.source=loc(found);p.basis='source-corroborated-query-name (see caller for wire use)';}
  }
  // Link every relevant named DTO, including nested/indexed/union aliases, to a
  // reusable component. These are available definitions, not all wire contracts.
  const namedTypes=[];
  for(const f of sources.filter(f=>/^src\/(api\/types|features\/[^/]+\/(?:model|types|contracts|client|service|package-client))/.test(rel(f.fileName)))) {
    for(const n of f.statements)if((ts.isInterfaceDeclaration(n)||ts.isTypeAliasDeclaration(n))&&!/(?:Dependencies|Ports?|Service|Client|State|Render|View|Browser|Callback|Translate|^Request$|^ApiFetch$|^RequestFn$|^RequestJSON$)/.test(text(n.name))) {
      const type=checker.getTypeAtLocation(n.name), schema=typeSchema(type);
      namedTypes.push({name:text(n.name),source:loc(n),schema});
    }
  }
  const list=[...ops.values()].sort((a,b)=>(a.group+' '+a.path+' '+a.method).localeCompare(b.group+' '+b.path+' '+b.method));
  for(const op of list){
    op.front=[...new Map(op.front.map(f=>[f.source+f.function,f])).values()];
    op.classification=op.mocks.length?(op.front.length?'shared':'mock-only'):'frontend-used';
    op.id=(op.method+'_'+op.path).replace(/[^a-zA-Z0-9]+/g,'_').replace(/_$/,'');
    op.expected=combine(op.front.flatMap(f=>[f.responseSchema,f.genericResponse,...(f.consumerViews??[]).map(v=>v.schema)]).filter(s=>s&&s['x-evidence']!=='unknown'));
    op.requestSchema=op.requests.length?combine(op.requests.map(r=>r.schema)):undefined;
    op.parameterEvidence=op.params;
    op.params=[...new Map(op.params.map(p=>[p.in+':'+p.name,p])).values()];
    for(const match of op.path.matchAll(/\{([^}]+)\}/g))op.params.unshift({name:match[1],in:'path',required:true,schema:str,source:op.mocks[0]?.source??op.front[0]?.source,basis:'URL-template'});
    if(op.path==='/api/c2/events/stream')op.protocol='sse';
  }
  const resolve = s=>s?.$ref?components[s.$ref.split('/').at(-1)]:s;
  function example(s,depth=0,seen=new Set()){
    if(!s||depth>10)return undefined;
    if(s.$ref){if(seen.has(s.$ref))return undefined;seen=new Set(seen);seen.add(s.$ref);return example(resolve(s),depth+1,seen);}
    if('const'in s)return s.const;
    if(s.enum)return s.enum[0];
    if(s.default!==undefined)return s.default;
    if(s.anyOf||s.oneOf){for(const sub of s.anyOf??s.oneOf){const v=example(sub,depth+1,seen);if(v!==undefined)return v;}return undefined;}
    if(Array.isArray(s.type))return example({...s,type:s.type.find(t=>t!=='null')??'null'},depth+1,seen);
    if(s.type==='object'){
      const out={};for(const [name,sub]of Object.entries(s.properties??{})){const v=example(sub,depth+1,seen);if(v!==undefined)out[name]=v;else if(s.required?.includes(name))return undefined;}return out;
    }
    if(s.type==='array')return [];
    if(s.type==='string')return s.format==='binary'?undefined:s.format==='date-time'?'2026-10-31T00:00:00Z':s.minLength?'x'.repeat(s.minLength):'';
    if(s.type==='integer'||s.type==='number')return Math.max(0,s.minimum??0);
    if(s.type==='boolean')return false;
    if(s.type==='null')return null;
    return undefined;
  }
  function samplePath(op,state){
    const resource=op.path.split('/')[2];
    const first=a=>a?.[0]?.id??'UNKNOWN';
    const id=resource==='projects'?first(state.projects):resource==='assets'?first(state.assets):resource==='vulnerabilities'?first(state.vulnerabilities):resource==='conversations'?first(state.conversations):resource==='messages'?first(state.messages):resource==='skills'?state.skills[0]?.name:resource==='roles'?state.aiRoles[0]?.name:resource==='external-mcp'?state.externalMCP[0]?.name:resource==='batch-tasks'?first(state.batchQueues):resource==='workflows'?first(state.workflows):resource==='webshell'?first(state.webshells):resource==='knowledge'?first(state.knowledgeItems):resource==='hitl'?first(state.hitlLogs):resource==='audit'?first(state.auditLogs):resource==='monitor'?first(state.executions):resource==='c2'?first(state.c2?.[op.path.split('/')[3]]):resource==='rbac'?first(state[op.path.split('/')[3]]):'UNKNOWN';
    return op.path.replace(/\{([^}]+)\}/g,(_,key)=>encodeURIComponent(key==='conversationId'?first(state.conversations):key==='queueId'?first(state.batchQueues):key==='taskId'?first(state.batchQueues[0]?.tasks):key==='factId'?first(state.facts):key==='edgeId'?first(state.factEdges):key==='runId'?state.workflowRuns?.[0]?.run.id??'UNKNOWN':key==='name'&&resource==='config'?'nmap_scan':key==='filename'?'orchestrator.md':id??'UNKNOWN'));
  }
  let mockExamples=0;
  for(const op of list){
    op.requestExample=example(op.requestSchema??(!op.front.length?op.mockRequest:undefined));
    if(!op.mocks.length||op.protocol==='sse'||op.path==='/api/openapi/spec')continue;
    const r=fresh();
    const body=op.requestMedia==='multipart/form-data'?new FormData():op.requestExample??{};
    if(op.path==='/api/auth/login'){body.username=r.state.users[0].username;body.password=r.state.auth.password;op.requestExample={...body};}
    try {
      // This dispatch is purely in-memory; no installed interception or network.
      const result=await r.dispatch({method:op.method,url:samplePath(op,r.state),headers:{},body,signal:null});
      if(result.body!==undefined){
        const reduced=JSON.parse(JSON.stringify(result.body,(_key,value)=>Array.isArray(value)?value.slice(0,1):value));
        op.observed={status:result.status,body:reduced,basis:'isolated-mock-dispatch; arrays shortened to first element'};
        if(result.status<400)mockExamples++;
      } else if(result.raw!==undefined)op.observed={status:result.status,raw:result.raw,basis:'isolated-mock-dispatch'};
    } catch(e){op.notes.push('Example unavailable: '+e.message);}
  }
  for(const op of list){
    if(op.observed?.status<400||op.protocol==='sse')continue;
    const response=op.responses.find(r=>r.media==='application/json'&&r.schema.format!=='binary');
    if(response)op.successIllustration={status:response.status,value:example(response.schema),basis:'resolved-TypeScript structural illustration, NOT an observed successful handler result'};
  }
  // Confirm route table and structural identities independently at runtime.
  const runtimeKeys=runtime.routes.map(r=>r.method+' '+structural(r.pattern));
  if(new Set(runtimeKeys).size!==runtimeKeys.length)throw new Error('Duplicate mock operation');
  for(const key of runtimeKeys)if(!ops.has(key))throw new Error('Missing mock operation '+key);
  if(unresolvedBaseline.length)throw new Error('Unaccounted previous operation');
  components.ErrorString=object({error:str},['error']);
  components.WorkflowPackageError=object({error:{anyOf:[str,object({code:str,message:str,details:object({})})]}});
  const paths={};
  for(const op of list){
    const responses={};
    for(const r of op.responses){
      if(!/^\d{3}$/.test(r.status))continue;
      const response=responses[r.status]??={description:'Mock implementation only; live status codes UNKNOWN',content:{}};
      const existing=response.content[r.media];
      response.content[r.media]={schema:existing?combine([existing.schema,r.schema]):r.schema};
    }
    if(!Object.keys(responses).length)responses['2XX']={description:'UNKNOWN exact success status. Frontend accepts a successful HTTP response; schema below is a frontend expectation, not a backend guarantee.',content:{[op.responseMedia??(op.protocol==='sse'?'text/event-stream':'application/json')]:{schema:op.protocol==='sse'?{type:'string',description:'See realtime-api-contracts.md'}:op.expected}}};
    for(const error of op.errors)if(/^\d{3}$/.test(error.status))responses[error.status]={description:'Mock error: '+error.message,content:{'application/json':{schema:{$ref:'#/components/schemas/ErrorString'}}}};
    if(op.mocks.length)responses['500']={description:'Mock dispatcher catches thrown handler exceptions (src/mock/router.ts:69–73). This is not a production error guarantee.',content:{'application/json':{schema:{$ref:'#/components/schemas/ErrorString'}}}};
    responses.default={description:'Non-success responses are handled by callers. Production status/error structure UNKNOWN. Mock exceptions become 500 {error:string}; protected transport observes 401/403 globally.',content:{'application/json':{schema:op.path.includes('workflow-package')?{$ref:'#/components/schemas/WorkflowPackageError'}:unknown('production error payload; {error:string} is common but not universal')},'text/plain':{schema:str}}};
    if(op.observed?.status<400&&op.observed.body!==undefined&&responses[String(op.observed.status)]?.content?.['application/json'])responses[String(op.observed.status)].content['application/json'].examples={mock:{summary:op.observed.basis,value:op.observed.body}};
    if(op.successIllustration?.value!==undefined&&responses[op.successIllustration.status]?.content?.['application/json'])responses[op.successIllustration.status].content['application/json'].examples={structural:{summary:op.successIllustration.basis,value:op.successIllustration.value}};
    const operation={tags:[op.group],operationId:op.id,summary:op.purpose,description:`Classification: ${op.classification}. Protocol: ${op.protocol}. This extraction documents frontend expectations and local mock evidence, not an available Raptix backend. Explicit client/server requiredness differs: consult x-frontend-requests and x-mock-request-schema. Unknown leaves are marked UNKNOWN.`,security:op.path==='/api/auth/login'?[]:[{bearerAuth:[]}],parameters:op.params.filter(p=>!['authorization','content-type','accept'].includes(p.name.toLowerCase())).map(p=>({name:p.name,in:p.in,required:p.in==='path'||p.name==='Idempotency-Key',schema:p.schema,description:`Evidence: ${p.basis}; ${p.source}. Requiredness is caller-side only; server requirement UNKNOWN.`,'x-source':p.source})),responses,'x-classification':op.classification,'x-protocol':op.protocol,'x-source':uniq([...op.front.map(f=>f.source),...op.mocks.map(m=>m.source)]),'x-frontend-callers':op.front,'x-frontend-requests':op.requests,'x-frontend-response-expectation':op.expected,'x-mock-request-schema':op.mockRequest??unknown('mock handler has no body decoder'),'x-mock-errors':op.errors};
    if(op.path==='/api/c2/events/stream')operation.security=[{queryToken:[]}];
    if(op.path==='/api/system/update'&&op.method==='GET')operation['x-auth-variants']='Settings client uses default stored bearer; restart watchdog intentionally uses bare fetch with same-origin credentials, no bearer, and interprets 401 as process-ready (src/platform/notification-browser.ts:18–21; src/features/update/service.ts:69–78).';
    if(op.requestSchema||op.mockRequest){
      operation.requestBody={required:false,description:op.requests.length?'Schema describes frontend-produced data; required fields mean properties in that TypeScript object, NOT confirmed server requirements. Mock alternatives are separately recorded.':'Only mock validation available. Handler may impose extra conditions; see errors and source.',content:{[op.requestMedia??'application/json']:{schema:op.requestSchema??op.mockRequest}}};
      if(op.requestExample!==undefined&&op.requestMedia!=='multipart/form-data')operation.requestBody.content['application/json'].examples={structural:{summary:'Type-derived structural illustration; not a successful or validated domain request',value:op.requestExample}};
    } else if(!['GET','HEAD'].includes(op.method))operation['x-request-body-uncertainty']=op.front.length?'No body observed or payload is unknown; inspect callers. Do not infer {}.':'UNKNOWN: mock ignores body; no frontend request found.';
    (paths[op.path]??={})[op.method.toLowerCase()]=operation;
  }
  const counts={http:list.length,paths:Object.keys(paths).length,mockRegistrations:runtime.routes.length,shared:list.filter(o=>o.classification==='shared').length,frontendUsedOnly:list.filter(o=>o.classification==='frontend-used').length,mockOnly:list.filter(o=>o.classification==='mock-only').length,legacy:list.filter(o=>o.classification==='legacy').length,sse:list.filter(o=>o.protocol==='sse').length,websocket:1,frontendOperations:list.filter(o=>o.front.length).length,withFrontendRequestSchemas:list.filter(o=>o.requestSchema).length,withMockRequestSchemas:list.filter(o=>o.mockRequest).length,withMockSuccessSchemas:list.filter(o=>o.responses.length).length,withFrontendResponseExpectations:list.filter(o=>o.expected?.['x-evidence']!=='unknown').length,successfulMockJsonExamples:mockExamples,baselineHttp:oldRows.filter(o=>o.method!=='WS').length,addedSinceBaseline:list.filter(o=>!o.previous).map(o=>o.method+' '+o.path)};
  const openapi={openapi:'3.1.0',jsonSchemaDialect:'https://json-schema.org/draft/2020-12/schema',info:{title:'Raptix extracted frontend API expectations and mock contracts',version:'2026-10-31',description:'Source-grounded extraction. NOT a future backend specification. Security requirements are advertised/client conventions; mock dispatcher does not enforce global authentication. UNKNOWN annotations and x-* evidence are part of this document. See api-contracts.md and api-contract-gaps.md.'},servers:[{url:'/',description:'Origin-relative default; VITE_API_BASE applies to shared HTTP only.'}],paths,components:{securitySchemes:{bearerAuth:{type:'http',scheme:'bearer',description:'Authorization: Bearer <stored token>, attached when available except auth:false login. Server enforcement UNKNOWN; mock OpenAPI advertises this but mock dispatcher does not enforce it.'}},schemas:components},'x-coverage':counts,'x-named-types':namedTypes};
  const pretty=v=>JSON.stringify(v,null,2);
  openapi.components.securitySchemes.queryToken={type:'apiKey',in:'query',name:'token',description:'Native C2 EventSource supplies the stored token as a query value, not an Authorization header (src/platform/access-browser.ts:66–69). Omitted when no stored token; server enforcement UNKNOWN.'};
  const fence=(language,code)=>'\n```'+language+'\n'+code+'\n```\n';
  const schemaLink=s=>s?.$ref?'['+s.$ref.split('/').at(-1)+'](#schema-'+s.$ref.split('/').at(-1).toLowerCase()+')':s?'inline schema below':'UNKNOWN';
  let catalog=`# Extracted API contracts — Raptix UI\n\nSnapshot: 2026-10-31. Scope: this standalone frontend only. No backend files or external services were consulted.\n\n## Reading the evidence\n\n- **${counts.http} unique HTTP method/path operations** on ${counts.paths} OpenAPI paths; ${counts.shared} shared, ${counts.frontendUsedOnly} frontend-used without a mock route, ${counts.mockOnly} mock-only; ${counts.legacy} confirmed compatibility-only operations. ${counts.sse} HTTP operations stream SSE; WebSocket is separately counted (${counts.websocket}).\n- Frontend-used means a concrete request definition/call expression exists in application source, including exported client seams. It is NOT proof every exported method is reachable from current UI. See unused-client caveats in the gaps report.\n- Explicit Zod schemas describe decoder **input** (defaults are client defaults, not server defaults). TypeScript-inferred schemas describe object construction or consumption; they do not establish runtime/server validation. Mock-confirmed responses are labeled separately.\n- Required arrays in schemas denote fields in the cited type/decoder. Mock partial bodies often allow every field while handlers still reject empty values. Additional object fields are not forbidden unless a decoder explicitly says so; never infer a closed backend DTO from an interface.\n- Types, unions, records, nullability and nested objects are resolved in the schema appendix/OpenAPI components. UNKNOWN leaves explain missing evidence. No empty-array fixture establishes an item contract.\n- Request examples are structural illustrations from resolved types (empty strings/arrays and zero are placeholders, not guaranteed valid inputs). Multipart requests are described as form fields, not fake JSON. Response examples come from isolated fresh in-memory mocks; arrays are shortened to one item, all object fields retained.\n- Status **200** means an explicit mock helper returns 200. Client-only exact success status is UNKNOWN (OpenAPI 2XX wildcard). Production errors/statuses remain UNKNOWN. Mock exception fallback: 500 {error:string}; schema failures: 400 {error:"Invalid request body"}. No claim of backend authorization enforcement.\n\n## Transport, authentication and headers\n\nShared HTTP: src/platform/http.ts:34–69; VITE_API_BASE prepended, query null/undefined omitted, JSON body sets Content-Type, stored token attached unless auth:false. 401 clears session and emits session-expired; 403 emits forbidden. Raw calls return Response and feature wrappers parse/check it. Login explicitly disables auth; other operations follow the default bearer convention when a token exists. Mock spec advertises bearer except login, but src/mock/router.ts does not enforce it globally; mock Auth validates state selectively. Per-operation server permissions, rate limits and actual authentication requirements are UNKNOWN.\n\nSame-origin legacy/raw/SSE/WS paths can bypass VITE_API_BASE. Browser multipart supplies boundary. Workflow import sends Idempotency-Key (src/features/workflows/package-client.ts:48–50). API Docs can dynamically execute spec-defined URLs; these are not an enumerable hardcoded API family (src/features/api-docs/service.ts or index.ts; see gaps).\n\nFor real-time framing/lifecycle see [realtime-api-contracts.md](realtime-api-contracts.md). Machine-readable schemas: [openapi.yaml](openapi.yaml). Reconciliation and limitations: [api-contract-gaps.md](api-contract-gaps.md).\n\n## Module index\n\n`;
  for(const group of uniq(list.map(o=>o.group)))catalog+=`- ${group}: ${list.filter(o=>o.group===group).length} operations\n`;
  for(const group of uniq(list.map(o=>o.group))){
    catalog+=`\n## ${group}\n`;
    for(const op of list.filter(o=>o.group===group)){
      catalog+=`\n<a id="${op.id.toLowerCase()}"></a>\n### ${op.method} \`${op.path}\`\n\n${op.purpose}. **${op.classification}**; ${op.protocol}.\n\n`;
      catalog+='**Sources/functions:** '+uniq([...op.front.map(f=>`${f.source} (${f.function})`),...op.mocks.map(m=>`${m.source} (${m.function})`)]).map(s=>'`'+s+'`').join('; ')+'.\n\n';
      catalog+='**Authentication:** '+(op.path==='/api/auth/login'?'unauthenticated login; auth:false.':op.path==='/api/c2/events/stream'?'Native EventSource uses the stored token in the token query parameter, not a bearer header; token is omitted when absent. Server enforcement UNKNOWN.':op.path==='/api/system/update'&&op.method==='GET'?'Settings client follows stored bearer convention. Restart watchdog intentionally bypasses the authenticated transport: bare fetch with same-origin credentials, no bearer; 401 means process-ready to that caller (src/platform/notification-browser.ts:18–21; update/service.ts:69–78). Server requirements UNKNOWN.':'default stored bearer token when available; mock advertises bearer but does not globally enforce it; server requirement/permissions UNKNOWN.')+'\n\n';
      catalog+='**Parameters:** '+(op.params.length?'known fields below; unlisted server parameters UNKNOWN.':'none observed; unknown additional server parameters.')+'\n\n';
      if(op.params.length){
        catalog+='| Location | Name | Requiredness | Schema | Evidence |\n| --- | --- | --- | --- | --- |\n';
        for(const p of op.params)catalog+=`| ${p.in} | \`${p.name}\` | ${p.in==='path'?'required':p.name==='Idempotency-Key'?'required by caller':'observed; server requiredness UNKNOWN'} | \`${JSON.stringify(p.schema).replaceAll('|','\\|')}\` | ${p.source}; ${p.basis} |\n`;
        catalog+='\n';
      }
      catalog+='**Request:** '+(op.requestMedia??'application/json when a JSON body is present')+'. '+(op.requestSchema?'Frontend construction schema '+schemaLink(op.requestSchema)+'.':op.front.length?'No body observed, or no resolved payload definition. GET/DELETE without a body must not be rewritten to {}.':'UNKNOWN frontend body; mock-only operation.')+'\n';
      if(op.requestSchema&&!op.requestSchema.$ref)catalog+=fence('json',pretty(op.requestSchema));
      for(const r of op.requests)catalog+=`\n- ${r.basis}: ${r.source}; schema ${schemaLink(r.schema)}; payload expression: \`${r.expression.replaceAll('`','\\`').replaceAll('\n',' ')}\`.\n`;
      if(op.mockRequest)catalog+='\n**Separate mock request decoder:** '+schemaLink(op.mockRequest)+'. Unknown keys may be stripped by Zod; do not merge this with frontend fields.\n';
      if(op.requestExample!==undefined)catalog+='\n**Request example (structural only):**'+fence('json',pretty(op.requestExample));
      else catalog+='\n**Request example:** '+(op.requestMedia?'multipart field schema above; binary bytes have no JSON example.':'UNKNOWN / no body. No fabricated request example.')+'\n';
      catalog+='\n**Successful response:** '+(op.responses.length?uniq(op.responses.map(r=>r.status+' '+r.media)).join('; ')+' (mock only).':'exact status UNKNOWN; caller accepts successful HTTP responses.')+'\n';
      for(const r of op.responses){catalog+=`\n- ${r.source}: ${schemaLink(r.schema)}. `;if(!r.schema.$ref)catalog+=fence('json',pretty(r.schema));}
      catalog+='\n**Frontend response expectation:** '+schemaLink(op.expected)+' (TypeScript/decoder consumption, not a production guarantee).\n';
      if(!op.expected.$ref)catalog+=fence('json',pretty(op.expected));
      if(op.observed?.body!==undefined)catalog+=`\n**${op.observed.status<400?'Mock response':'Mock error'} example:** status ${op.observed.status}; ${op.observed.basis}.`+fence('json',pretty(op.observed.body));
      else if(op.observed?.raw!==undefined)catalog+='\n**Mock raw response example:**'+fence('text',op.observed.raw);
      else catalog+='\n**Response example:** UNKNOWN or streaming; inspect cited producer and realtime document.\n';
      if(op.successIllustration?.value!==undefined)catalog+='\n**Success-shape illustration (not observed success):** '+op.successIllustration.basis+'.'+fence('json',pretty(op.successIllustration.value));
      catalog+='\n**Known errors:** '+(op.errors.length?uniq(op.errors.map(e=>`${e.status}: {error:string}; ${e.message}; ${e.source}`)).join('; '):'no operation-specific error branches found.')+' Global mock exceptions can return 500 {error:string}. Live error codes/payloads UNKNOWN. Workflow package clients additionally understand {error:{code?,message?,details?}}.\n';
      catalog+='\n<details><summary>Exact mock handler and frontend request evidence</summary>\n';
      for(const s of op.snippets)catalog+='\n'+s.source+fence('ts',s.code);
      for(const f of op.front)catalog+='\n'+f.source+' ('+f.function+')'+fence('ts',f.expression);
      catalog+='\n</details>\n';
    }
  }
  catalog+='\n## Resolved schema appendix\n\nJSON Schema 2020-12. `$ref` names link to this appendix and match OpenAPI components. `additionalProperties: true` in TypeScript inference means unknown extra fields were not forbidden, not that the server accepts them. Zod input defaults/constraints come directly from source; transforms remain described by source rather than invented wire constraints.\n';
  for(const [name,schema]of Object.entries(components))catalog+=`\n<a id="schema-${name.toLowerCase()}"></a>\n### ${name}\n`+fence('json',pretty(schema));
  catalog+='\n## Named TypeScript definition index\n\n'+namedTypes.map(t=>`- \`${t.name}\` — ${t.source} — ${schemaLink(t.schema)}`).join('\n')+'\n';
  catalog=catalog.replace('src/features/api-docs/service.ts or index.ts','src/features/api-docs/index.ts');
  const gaps=buildGaps(list,counts,unresolvedBaseline,excludedArtifacts,namedTypes);
  const realtime=buildRealtime();
  for(const [file,content]of Object.entries({'docs/openapi.yaml':pretty(openapi)+'\n','docs/api-contracts.md':catalog,'docs/api-contract-gaps.md':gaps,'docs/realtime-api-contracts.md':realtime}))fs.writeFileSync(file,content);
  console.log(pretty({counts,components:Object.keys(components).length,files:['docs/api-contracts.md','docs/openapi.yaml','docs/realtime-api-contracts.md','docs/api-contract-gaps.md']}));
}

function buildGaps(list,counts,missing,artifacts,namedTypes){
  const rows=items=>items.map(o=>`| ${o.method} \`${o.path}\` | ${o.classification} | ${uniq([...o.front.map(f=>f.source),...o.mocks.map(f=>f.source)]).join('; ')} |`).join('\n');
  let out=`# API contract gaps and coverage\n\nSnapshot: 2026-10-31. Source scope: ui-app only. No live Raptix backend is present or assessed. No application, mock, storage or transport behavior was changed.\n\n## Exact inventory reconciliation\n\n`;
  out+='```json\n'+JSON.stringify(counts,null,2)+'\n```\n\n';
  out+=`The old reference has **299 rows including one WS interface**: 298 HTTP operations, not 299 HTTP APIs. Current source adds GET /api/workflows/runs and GET /api/batch-tasks/runs, giving **${counts.http} HTTP operations plus one WebSocket interface**. All ${counts.mockRegistrations} runtime mock registrations are represented, with unique normalized method/path pairs. GET /api/hitl/logs/{id} is now mock-supported despite the old table's client-only label. RBAC frontend management was removed, so all fourteen RBAC mock routes are mock-only, not currently used compatibility calls. Legacy classification count is zero: a historical name alone is insufficient evidence of a compatibility-only API.\n\n`;
  out+='Counts overlap intentionally: SSE operations are HTTP operations, not extra method/path entries. A generic mock EventSource heartbeat is transport simulation, not an HTTP route registration. No synthetic GET /api/terminal/ws operation is added to OpenAPI; it is documented as a WebSocket protocol.\n\n';
  out+='## Evidence quality and limitations\n\n- Source AST walks concrete request calls, helper-expanded paths and runtime mock registrations. Conditional method/path pairs are correlated rather than counted as every Cartesian combination. Source evidence excerpts are retained per operation. Wrapper families (update, WeChat, C2 bulk/file) are explicitly expanded from their callers.\n- TypeScript interfaces/aliases/index signatures/unions are expanded into reusable JSON Schema components. Zod schemas are exported in input mode, preserving known optionality, nullability, constraints and client defaults. Transforms/unknowns that cannot be expressed are marked UNKNOWN. Compiler-derived object requiredness is not server validation.\n- Some exported client methods have no current UI consumer. `frontend-used` means source-level request definition, not verified interaction reachability. Unused client seams are retained in the inventory rather than quietly omitted.\n- Mock response schemas are inferred from return expressions and their nested DTOs; empty arrays establish no element fields. Concrete mock examples use fresh in-memory fixture state, never network requests. Arrays in examples are limited to one element without removing nested object fields. A handler that returns an error for the structural request is shown as an error example, not a success.\n- Structural request examples are type illustrations, not domain-valid requests or successful contract tests. Empty names/passwords/prompts may deliberately fail handler checks. Binary uploads and unresolved values have no fabricated JSON example.\n- Caller-only exact success statuses, server auth enforcement/permissions, full validation, pagination bounds, missing error enums, and future Raptix compatibility remain UNKNOWN. Shared HTTP handles 401/403 centrally but this is not endpoint-specific server evidence.\n- Named type index includes supporting UI models to make nested definitions traceable; a UI-only field must not automatically be treated as a wire field. OpenAPI x-frontend-* views are distinct from mock response schemas.\n- Prior query notes are explicitly labeled prior-inventory where direct parameter mapping was not recovered; source excerpts remain the authority. No historical table claim silently upgrades to confirmed schema.\n\n';
  out+='## Confirmed frontend/mock differences\n\n| Area | Frontend expectation | Mock behavior / source | Consequence |\n| --- | --- | --- | --- |\n';
  out+='| Password change | oldPassword/newPassword (src/api/clients/auth.ts; src/features/settings/client.ts:32) | current_password/new_password (src/mock/bodies.ts:10; routes/auth.ts:68) | camelCase stripped/missing; 400 rather than successful change |\n';
  out+='| Notifications read | eventIds (src/features/notifications/client.ts) | ids (bodies.ids; routes/security.ts:104) | missing ids means mock marks all read |\n';
  out+='| Assets import | created/updated/skipped, normalized legacy imported fallback (src/api/clients/assets.ts) | imported counter and sparse asset DTOs (routes/security.ts:437) | explicit normalization; missing timestamps must not be fabricated |\n';
  out+='| Assets bulk/delete | asset_ids plus direct patch fields (src/features/assets/service.ts:132–135) | ids and nested patch (src/mock/bodies.ts:15; routes/security.ts:450–463) | request names/shape differ; empty/no-op operations possible |\n';
  out+='| Asset project binding/merge/scan links | mutations sent by source (src/features/assets/service.ts) | unconditional acknowledgements (routes/security.ts:448–464) | mock success does not prove a state change |\n';
  out+='| Vulnerability batch | DELETE with filters, no body (src/features/vulnerability/service.ts:41) | ids decoder, absent body defaults {}, handler selects matching (routes/security.ts:334) | two modes must be distinguished |\n';
  out+='| Vulnerability subscription | min_severity (src/features/vulnerability/service.ts:45) | minSeverity (src/mock/bodies.ts:14; routes/security.ts:379) | casing mismatch; submitted threshold can be discarded |\n';
  out+='| Vulnerability pagination (resolved historical gap) | total_pages required by shared client decoder | current mock now includes total_pages (routes/security.ts:295–302); shared adapter retains old missing-field fallback (src/api/clients/vulnerabilities.ts:6) | old omission claim is obsolete; fallback preserved, not an active mock mismatch |\n';
  out+='| Facts/edges | rich keys/confidence/categories and graph views | mock only honors selected fields and literal true checks (routes/security.ts:192–277) | exclude_deprecated=1 or view semantics not equivalent; some fields default rather than persist |\n';
  out+='| Run cancellation | conversationId plus optional mode/note controls in chat/progress/tasks.ts | bodies.agent only retains message/conversationId/projectId/role; cancel flag only (routes/chat.ts:243) | stop-tool/continue semantics not simulated |\n';
  out+='| Queue schedule (resolved historical gap) | scheduleEnabled; compatibility can also add enabled (src/features/tasks/service.ts:79) | current mock reads scheduleEnabled ?? enabled (routes/security.ts:623) | fallback remains, but camelCase request now works directly |\n';
  out+='| Tool guard test | config, toolName, arguments (src/features/tool-guard/service.ts:98) | command-only regex with blocked/reason (routes/platform.ts:127) | UI expected match metadata not simulated |\n';
  out+='| MCP configuration | PUT {config:{...}}; servers record/config nesting, upsert-style UI (src/features/settings/client.ts:33–37) | flat bodies.mcp; PUT requires existing name and merges limited flat fields (routes/platform.ts:395–450) | new-server save/config changes may fail or be discarded |\n';
  out+='| Skills content | POST/PUT description/content and package file writes | bodies.skill has metadata but no content; file PUT acknowledges without persistence (routes/platform.ts:184–224) | metadata fixtures do not prove content edits |\n';
  out+='| Knowledge content | title/content/category plus frontend wire variants (src/features/knowledge/service.ts) | narrowed knowledge DTO and fixed indexing simulation (routes/platform.ts:291–379) | metadata/index coverage incomplete |\n';
  out+='| Markdown agents | id/name/instruction/tools/bind_role/max_iterations/kind (src/features/agents/service.ts:21) | POST filename-only, PUT ignores body, GET returns template (routes/platform.ts:272–287) | no full definition persistence |\n';
  out+='| Workflow graph | richer frontend graph config, edge labels/config, graph_json string or object | mock graph drops unsupported fields; validate/dry-run abbreviated (src/mock/types.ts:39; routes/platform.ts:464–530) | successful mock save is not full-fidelity orchestration validation |\n';
  out+='| Workflow draft/package | AiResult and inspection/import decoder with id/workflow/conflict | abbreviated nodes and inspectionId/importId placeholder payloads; alias normalization in package-client.ts | draft adapter composes special demo response; package bytes not a real .csapkg.zip |\n';
  out+='| C2 payload build | PayloadBuild artifact metadata (src/features/c2/model.ts) | HTTP 200 {error:"Beacon compilation is unavailable..."} (routes/platform.ts:665) | semantic failure on successful HTTP; no binary generated |\n';
  out+='| C2 file/terminal tasks | typed tasks, resultText, task_id/task, approval and result-file stages | partial fixed task simulation; staged upload/result-file no mock registration (src/features/c2/service.ts; routes/platform.ts:609–639) | cannot infer successful remote transfers |\n';
  out+='| WebShell exec/files | ExecResult.ok and output (src/features/webshell/model.ts; service.ts:134–166) | success:true instead of ok; file returns entries, not parser output (routes/platform.ts:719–725) | UI reports execution/file failure, despite 200 |\n';
  out+='| WebShell AI list | plain AiConversation[] (src/features/webshell/service.ts) | {conversations:[]} (routes/platform.ts:717) | consumer .map failure |\n';
  out+='| WebShell persistence | dbState/terminalSessions (src/features/webshell/service.ts:86–100) | PUT acknowledgement; GET empty state (routes/platform.ts:714–715) | no persisted workspace state in demo |\n';
  out+='| Storage cleanup | dry_run/confirm and rich cleanup model | request ignored, fixed freed_bytes/message (routes/platform.ts:738) | preview and execute not differentiated |\n';
  out+='| Update console | status/job/source objects (src/features/update/types.ts; service.ts:36–42) | mostly flat version/status placeholders (routes/platform.ts:740–749) | UI treats much of payload as absent; not a real updater |\n';
  out+='| Recon parse/search | provider/text for parse; SearchForm options and provider limits for search (src/features/info-collect/service.ts:38–42) | query-only input; fixed rows (routes/platform.ts:753–763) | parse text/provider dropped; no provider-specific execution |\n';
  out+='| WeChat binding | session_key, URL/image/status details (src/features/wechat-robot/types.ts) | empty qrcode/demo/idle/success:false (routes/platform.ts:765–768) | clearly unavailable real binding, not an API success claim |\n';
  out+='| Generic mock fallback | absent endpoint should not be assumed supported | router.ts:79 returns 200 {} and logs unhandled | a green HTTP status alone does not establish a contract |\n\n';
  out+='## Frontend-used operations without HTTP mock registrations\n\n| Operation | Classification | Evidence |\n| --- | --- | --- |\n'+rows(list.filter(o=>!o.mocks.length))+'\n\n';
  out+='## Mock-only / currently unused HTTP operations\n\n| Operation | Classification | Evidence |\n| --- | --- | --- |\n'+rows(list.filter(o=>!o.front.length))+'\n\n';
  out+='## Unresolved response definitions\n\nThe following operations have no resolved concrete frontend response type; their mock schema (if any) is separately documented. Operations returning untyped acknowledgements are intentionally retained.\n\n| Operation | Classification | Evidence |\n| --- | --- | --- |\n'+rows(list.filter(o=>o.expected?.['x-evidence']==='unknown'))+'\n\n';
  out+='## Missing or ignored body definitions\n\nA write without a resolved frontend body may intentionally send no body. This list does not claim all of these need JSON. Mock-only writes without a decoder are genuinely UNKNOWN/ignored, not confirmed empty-object contracts.\n\n| Operation | Classification | Evidence |\n| --- | --- | --- |\n'+rows(list.filter(o=>!['GET','HEAD'].includes(o.method)&&!o.requestSchema))+'\n\n';
  out+='## Legacy, duplicate and dynamic dependencies\n\n- Alternate /api/mcp/* versus /api/monitor/*; /api/ai/models versus /api/config/list-models; POST /api/config versus PUT /api/config; JSON agent methods versus streaming methods; these are distinct method/path operations, not safe renames.\n- Shared src/api/clients assets/projects/vulnerabilities/chat/auth factories have no non-test imports found outside their modules in this snapshot. Their request definitions remain included; actual UI often uses feature-owned services. src/features/chat/client.ts does import the shared conversations client. Do not classify the entire typed client library as runtime-reachable UI or delete it based on this report.\n- API Docs dynamically invokes a selected specification path/method with user-entered fields (src/features/api-docs/index.ts); arbitrary external specification operations cannot be enumerated statically. The mock OpenAPI response lists registered mock routes only and omits body/response contracts; it is not this extracted specification.\n- C2 profile URI /api/v1/status is configuration/example content, not an extra call site. Legacy strings in comments are not evidence of reachable operations. Generic transport prefix /api/ is not an endpoint.\n- No compatibility-only endpoint caller was confirmed; legacy count 0. Fourteen RBAC endpoints still exist in mock source despite removal of their page.\n\n';
  out+='## Reconciliation details\n\n- Unmatched previous HTTP rows: '+missing.length+'.\n- Runtime mock registrations omitted: 0 (asserted by generator).\n- Added since the previous catalog: '+counts.addedSinceBaseline.join('; ')+'.\n- Excluded static-analysis artifacts (conditional combinations/query delimiter branches), with source evidence:\n\n';
  out+='```json\n'+JSON.stringify(artifacts,null,2)+'\n```\n\n';
  out+='## Validation record\n\nGeneration ran local TypeScript AST/type analysis and instantiated only fresh in-memory mocks without browser startup/interception. Generated schemas must be checked as JSON Schema 2020-12; OpenAPI structure and reference/example validation results are recorded after execution below. No frontend–backend compatibility check, real terminal session, upload, bot message, security action or deployment occurred.\n\nThe deliverables retain UNKNOWN fields/statuses instead of inventing backend contracts. All operations require future comparison against the real Raptix backend, including those with complete mock definitions.\n';
  return out;
}

function buildRealtime(){
  const eventSource=sourceByPath.get('src/mock/events.ts');
  const typeSource=sourceByPath.get('src/api/types/chat.ts');
  const c2=sourceByPath.get('src/features/c2/model.ts');
  const eventFields=eventSource.statements.find(n=>ts.isInterfaceDeclaration(n)&&text(n.name)==='RunEventData');
  let out=`# Realtime, streaming and terminal API contracts\n\nSnapshot: 2026-10-31. Extracted only from ui-app. No real backend transport was contacted. HTTP handshake/stream operations also occur in openapi.yaml; the WebSocket is separate.\n\n## Protocol inventory\n\n| Method/path | Wire protocol | Classification/evidence |\n| --- | --- | --- |\n| POST /api/eino-agent/stream | Fetch response, text/event-stream | shared; src/api/clients/chat.ts, src/features/chat/client.ts, src/mock/routes/chat.ts:424 |\n| POST /api/multi-agent/stream | Fetch response, text/event-stream | shared; same sources, routes/chat.ts:425 |\n| GET /api/agent-loop/task-events | Fetch response, text/event-stream | shared; src/features/chat/replay/attach.ts:97; routes/chat.ts:251 |\n| GET /api/c2/events/stream | Native EventSource; JSON data messages | frontend-used; src/platform/access-browser.ts:66. No HTTP mock route; generic demo EventSource intercept emits only heartbeats |\n| POST /api/terminal/run/stream | Fetch SSE producer | mock-only; src/mock/routes/platform.ts:676 |\n| WS /api/terminal/ws | interactive terminal text/control/binary frames | frontend-used and generic socket mock-supported; src/features/terminal/service.ts:12; src/mock/terminal.ts |\n\nThere are five HTTP streaming operations and one WebSocket connection path. Native EventSource is not used for authenticated POST chat. No additional websocket path was found in source. src/platform/ws.ts is a generic utility, not another endpoint.\n\n## Agent request and endpoint selection\n\nsrc/platform/agent-endpoint.ts reads /api/config: multi_agent.enabled selects /api/multi-agent, otherwise /api/eino-agent; stream suffix defaults true. The typed client also exposes non-streaming JSON methods with the same ChatRequest. JSON requests use Content-Type: application/json and (in typed chat client) Accept: text/event-stream. Shared HTTP adds Authorization bearer when session exists; these fetch calls can use custom injected transports. Server auth/permission enforcement UNKNOWN.\n\nChatRequest (all nested fields below are explicit source types; no invented enum restrictions):\n\n`;
  const request=typeSource.statements.find(n=>ts.isInterfaceDeclaration(n)&&text(n.name)==='ChatRequest');
  out+='```ts\n'+text(request)+'\n```\n\n';
  out+='Typical structural request (field names/types only, not an observed run):\n\n```json\n{"message":"","conversationId":"","projectId":"","role":"","attachments":[],"hitl":{"enabled":false},"reasoning":{"mode":"","effort":""},"finalization":{"requireExecutionEvidence":true}}\n```\n\nWebShell AI supplies webshellConnectionId and requireExecutionEvidence:true, optionally projectId/reasoning (src/features/webshell/service.ts:254–255). The mock bodies.agent decoder accepts only message, nullish conversationId, projectId and role; extra ChatRequest fields are stripped. Empty message causes 400 {error:"Message is required"}. Mock conversation creation and scripted run have no real execution side effects.\n\n';
  out+='## SSE framing and decoding\n\nSource: src/platform/sse.ts:15–98. UTF-8 decoder maintains a chunk buffer; handles CR, LF and CRLF. A blank line completes a frame. data lines join with newline; event defaults message; id persists and excludes NUL; retry accepts nonnegative digit text. Comment lines beginning colon are ignored. Default maximum event/line buffer is 8 Mi characters. EOF flushes a final event even without a blank separator. readSseFrames yields {event:string,data:string,id:string,retry?:number}. parseSse JSON.parse decodes data; [DONE] stops parsing; optional schema validates the JSON envelope. It does not itself implement reconnection/Last-Event-ID. Malformed JSON/oversize frames throw. Abort cancels reader, finally releases its lock.\n\nMock buildMockResponse (src/platform/mock-transport.ts:22–60) emits data: <JSON> followed by a blank line, Content-Type:text/event-stream and Cache-Control:no-cache. Event type is the JSON type field, not an SSE event header. Array producer delay defaults 120 ms; __delay is removed before sending. Signals and reader cancellation stop the stream; producer errors error the stream. Mock does not emit a required [DONE] marker.\n\nExample frame shape (from the mock producer, not a captured backend):\n\n```text\ndata: {"type":"response_delta","message":"Hi","data":{"conversationId":"conv-recon-01","delta":"Hi"}}\n\n```\n\nThe example delta is illustrative text; event structure and conversation ID are source-grounded.\n\n';
  out+='## Envelope and event payloads\n\nExplicit envelope: {type:string,message:string,data?:unknown}; z.looseObject permits extra keys (src/api/types/chat.ts:25). Known narrowed payload schemas exist for conversation, message_saved and response; response agentMode is optional and mcpExecutionIds can be null. Event type remains open; unknown/new event kinds must not be silently treated as impossible.\n\nThe scripted mock emits the following exact payload interfaces; publish() adds conversationId to every event data object (src/mock/routes/chat.ts:193):\n\n```ts\n'+text(eventFields)+'\n```\n\n';
  out+='Production-specific progress/workflow/tool payloads consumed elsewhere may have additional fields. Open-ended data, finalization metadata, per-agent streams and embedded execution details are not closed enums. Source consumer evidence is supplied below so fields not in mock interfaces remain visible.\n\n';
  for(const p of ['src/api/types/chat.ts','src/features/chat/stream.ts','src/features/chat/events.ts','src/features/webshell/ai.ts']){const f=sourceByPath.get(p);if(f)out+='### '+p+'\n\n```ts\n'+f.text+'\n```\n\n';}
  out+='## Completion, cancellation and reattachment\n\nThe mock starts an independent background run, publishes conversation/message_saved, planning/iteration/thinking, optional knowledge/tool/HITL, response deltas, final response and done. Error scenario emits error then done(status:error). Rejection emits hitl_rejected and done; cancellation emits cancelled. Final response carries finalized/finalizable/evidenceVerified, completionReason, missingChecks and execution IDs (routes/chat.ts:315–421). A model-looking response alone is not proof of completion: WebShell checks finalization/evidence fields (service.ts:34–42, 248 onward).\n\nAborting a fetch reader does not cancel the background agent. UI cancellation calls POST /api/agent-loop/cancel. Reattach first checks active tasks, then GET task-events?conversationId=<id>, loads process details/inline approvals and consumes replay. The mock replays from index 0 then follows live events; after run completion the run is retained up to 30 seconds. No active run produces heartbeat every 15 seconds and stays open until cancelled. No cursor, delivery ordering across reconnects, exactly-once delivery, or Last-Event-ID resumption contract is defined. Replay consumer reconciles stored conversation on EOF/no done (src/features/chat/replay/attach.ts:73–180). Stream parser failure and non-OK handshake are client errors; exact production HTTP error schemas remain UNKNOWN.\n\n';
  out+='## C2 native EventSource\n\nConnection: same-origin /api/c2/events/stream?token=<URL-encoded stored token>; absent token omits query. No custom Authorization header, credentials option or subprotocol is supplied by openAccessEventStream. Listener processes default message events, JSON.parse payload, ignores malformed JSON and returns close() that calls source.close(). Native EventSource owns reconnect/retry; no explicit reconnect/backoff or event ID logic in this wrapper.\n\nC2Event source type (not proof every property appears in an event):\n\n';
  const c2Event=c2.statements.find(n=>ts.isInterfaceDeclaration(n)&&text(n.name)==='C2Event');
  out+='```ts\n'+text(c2Event)+'\n```\n\n';
  out+='src/features/c2/service.ts:240–263 reacts to session/task category, level, message and sessionId/data.session_id, refreshes affected views and closes stream when leaving C2/disposal. In demo, src/platform/mock-transport.ts:164–197 intercepts any /api/ EventSource pathname, opens after ~80 ms, emits only {type:"heartbeat",message:"",data:{}} every 15 seconds (src/mock/index.ts:19), closes by clearing timer. This is not evidence of real C2 session/task event payloads or HTTP endpoint registration.\n\n';
  out+='## Interactive PTY WebSocket\n\nURL: ws://<current host>/api/terminal/ws or wss:// for HTTPS; optional token query URL-encoded (src/features/terminal/service.ts:12–13). No protocol/headers negotiated in the frontend. Handshake status/auth failure body, origin policy, ping/pong and real server timeouts UNKNOWN. Each tab owns a PTY connection.\n\nClient-to-server frames: ordinary input is raw string keystrokes (not a JSON envelope). Control frame is JSON {"type":"resize","cols":80,"rows":24}. Client accepts integral dimensions 1..65535; stores default 80x24, sends current size on open, then drains pending keystrokes. Queue max 256 while connecting; overflow reports error. Closed/replacement PTY clears queue, so input is not replayed into another PTY. No automatic timer reconnect: send() can trigger connect() after closure. Disposal removes listeners and closes with code 1000 / reason Client closed.\n\nServer-to-client: raw string, ArrayBuffer or Blob supported. Binary/Blob converts to Uint8Array; Blob conversions are serialized with subsequent frames, preventing output reorder. Raw bytes/text go to terminal output, no server JSON message envelope is required. Native errors/close are reported to UI; no application-level close code enum is defined. Generic src/platform/ws.ts also queues frames but is not a separate wire protocol.\n\nMock source src/mock/terminal.ts: fake prompt, echo/backspace/newline handling; ignores resize JSON. whoami/pwd/id/uname/ls/help/date/clear return fixed/demo output. No shell executes. Socket transport interception opens after ~120 ms, greets with empty send, stringifies sent data and emits text frames only. Binary support is client expectation, not mock-confirmed binary behavior. Any /api/ WebSocket pathname is broadly intercepted; only terminal/ws is an actual frontend path.\n\n';
  out+='## Mock-only command streaming\n\nPOST /api/terminal/run/stream request {command?:string} (bodies.command), defaults empty command. HTTP 200 SSE emits {type:"output",message:"demo output for: <command>",data:{}} then {type:"done",message:"",data:{exitCode:0}}, ~200 ms array delay. No active frontend caller found. POST /api/terminal/run is a separate JSON operation returning {command:string,exitCode:number,output:string}. These are not the PTY WebSocket protocol.\n\n## Verification boundaries\n\nConnection paths, serialization and lifecycle are source-inspected. Runtime mock route inventory is reconciled in api-contract-gaps.md; this extraction did not run real streaming/remote execution, websocket handshakes, reconnect/failure testing against a backend, or browser packet capture. Unknown event variants/auth/server statuses must be verified later; no integration readiness claim is made.\n';
  return out;
}
```
