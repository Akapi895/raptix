import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const excludedDirectories = new Set([
  '.git', 'node_modules', 'dist', 'dist-demo', 'test-results', 'playwright-report',
]);
// Explicit ranges avoid matching the middle dot used in English UI labels.
const cjk = /[\u2e80-\u303f\u3040-\u30ff\u31c0-\u31ef\u3200-\u32ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/u;

async function findCjk(directory: string): Promise<string[]> {
  const violations: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) violations.push(...await findCjk(path));
    } else if (entry.isFile()) {
      const bytes = await readFile(path);
      if (bytes.includes(0)) continue; // Binary assets are not source text.
      const lines = bytes.toString('utf8').split(/\r?\n/);
      for (const [index, line] of lines.entries()) {
        if (cjk.test(line)) violations.push(`${relative(root, path)}:${index + 1}`);
      }
    }
  }
  return violations.sort();
}

it('keeps UI sources, markup, tests and documentation free of literal CJK characters', async () => {
  expect(await findCjk(root), 'Use English presentation text or Unicode escapes for backend contracts.').toEqual([]);
});
