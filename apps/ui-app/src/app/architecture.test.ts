import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { architecture } from '../../build/eslint-architecture.js';

const project = fileURLToPath(new URL('../../', import.meta.url));
type HtmlNode = DefaultTreeAdapterTypes.Node;

function elements(node: HtmlNode): DefaultTreeAdapterTypes.Element[] {
  return [ ...('tagName' in node ? [node] : []), ...('childNodes' in node ? node.childNodes.flatMap(elements) : []) ];
}

describe('module application architecture', () => {
  it('has direct HTML entries with module scripts and no executable attributes', () => {
    for (const [file, entry] of [['index.html', '/src/main.ts'], ['api-docs.html', '/src/api-docs.ts']]) {
      const html = readFileSync(join(project, file!), 'utf8');
      const nodes = elements(parse(html));
      const scripts = nodes.filter(node => node.tagName === 'script');
      expect(scripts.map(node => Object.fromEntries(node.attrs.map(attr => [attr.name, attr.value]))), file).toEqual([
        { type: 'module', src: entry },
      ]);
      expect(nodes.flatMap(node => node.attrs.filter(attr => /^on[a-z]+$/.test(attr.name))), file).toEqual([]);
      expect(html, file).not.toMatch(/<!-- (?:app|api-docs)-shell -->/);
      expect(nodes.some(node => node.attrs.some(attr => attr.name === 'id' && attr.value === (file === 'index.html' ? 'login-overlay' : 'api-group-list'))), file).toBe(true);
    }
  });

  it('contains no legacy directory, bridge files, or classic runtime', () => {
    expect(existsSync(join(project, 'src/legacy'))).toBe(false);
    expect(existsSync(join(project, 'src/platform/classic-runtime.ts'))).toBe(false);
    expect(existsSync(join(project, 'build/legacy-shell.ts'))).toBe(false);
    const files = readdirSync(join(project, 'src'), { recursive: true }).map(String);
    expect(files.filter(file => /(?:^|[\\/])(?:compat|legacy)(?:[\\/]|$)|-bridge\.[tj]s$/.test(file))).toEqual([]);
  });

  it('preserves the stylesheet cascade and the red brand', () => {
    const styles = readFileSync(join(project, 'src/styles/index.ts'), 'utf8');
    expect([...styles.matchAll(/import '([^']+)'/g)].map(match => match[1])).toEqual([
      './style.css', './tool-guard.css', './chat-plan-progress.css', './c2.css',
      '@xterm/xterm/css/xterm.css', './mobile.css', './project-switcher.css', './chat-workspace.css', './execution-approvals.css', './asset-workspace.css', './workflow-builder.css', './capabilities.css', './file-manager.css', './vulnerability-workspace.css',
    ]);
    expect(readFileSync(join(project, 'src/styles/style.css'), 'utf8')).toMatch(/#c62828/i);
  });

  it('enforces boundaries for new modules and renamed facades, including platform global exports', () => {
    const lint = new Linter();
    const verify = (source: string, file = 'src/app/renamed-adapter.ts') => lint.verify(source, [{
      files: ['**/*.ts'],
      languageOptions: { parser: tseslint.parser, ecmaVersion: 'latest', sourceType: 'module' },
      plugins: { architecture: architecture as never }, rules: { 'architecture/boundaries': 'error' },
    }], { filename: join(project, file) });
    for (const source of [
      'const alias = window;',
      'const alias = globalThis;',
      'const view = self;',
      'type Dependencies = Window;',
      'Object.assign(window, { sendMessage() {} });',
      'Reflect.set(globalThis, "state", {});',
      'const html = `<button onclick="save()">Save</button>`;',
      'document.querySelector("button[onclick*=save]");',
      'import { start } from "../legacy/start";',
      'import("../renamed-bridge.ts");',
      'new Function("return 1")();',
      'eval("save()")',
    ]) expect(verify(source).length, source).toBeGreaterThan(0);
    for (const source of [
      'Object.assign(window, { sendMessage() {} });',
      'Object.defineProperty(window, "state", { value: {} });',
      'window.feature = {};',
      'new Proxy(window, {});',
    ]) expect(verify(source, 'src/platform/renamed-adapter.ts').length, source).toBeGreaterThan(0);
    expect(verify('const width = window.innerWidth;', 'src/platform/browser.ts')).toEqual([]);
    expect(verify('import { browser } from "../platform/browser"; const width = browser.viewport().width;')).toEqual([]);
  });

  it('has no runtime source exempted from lint through legacy patterns', () => {
    const config = readFileSync(join(project, 'eslint.config.js'), 'utf8');
    expect(config).not.toContain("'src/legacy/**'");
    expect(config).not.toContain("'src/mock/legacy/**'");
    for (const file of readdirSync(join(project, 'src'), { recursive: true }).map(String).filter(file => file.endsWith('.ts') && !/\.(?:test|spec)\.ts$/.test(file))) {
      const source = readFileSync(join(project, 'src', file), 'utf8');
      expect(source, relative(project, join(project, 'src', file))).not.toMatch(/@ts-nocheck|eslint-disable[^\n]*architecture/);
    }
  });
});
