import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const tmp = 'D:/.VTNet/redteam/raptix/apps/web-improve/.ua/tmp';
const outDir = 'D:/.VTNet/redteam/raptix/apps/web-improve/.ua/intermediate';

const scan = JSON.parse(readFileSync(`${tmp}/ua-scan-files.json`, 'utf8'));
const imports = JSON.parse(readFileSync(`${tmp}/ua-import-map-output.json`, 'utf8'));

const result = {
  name: 'figma-make-app',
  description:
    'Ứng dụng single-page React 19 + Vite 8 + Tailwind CSS v4 được sinh từ Figma Make, dựng bản mẫu giao diện cho một nền tảng vận hành tác tử/nghiên cứu bảo mật với hơn 30 màn hình (dashboard, login, console, findings, report, chat…), dữ liệu demo tĩnh trong data.ts và state tập trung trong store.tsx.',
  languages: ['CSS', 'HTML', 'JavaScript', 'JSON', 'Markdown', 'TOML', 'TypeScript'],
  frameworks: ['react', 'tailwindcss', 'vite'],
  files: scan.files.map((f) => ({ path: f.path, language: f.language, sizeLines: f.sizeLines, fileCategory: f.fileCategory })),
  totalFiles: scan.totalFiles,
  filteredByIgnore: scan.filteredByIgnore,
  estimatedComplexity: scan.estimatedComplexity,
  importMap: imports.importMap,
};

if (!scan.scriptCompleted || !imports.scriptCompleted) throw new Error('upstream script did not complete');
if (result.totalFiles !== result.files.length) throw new Error('totalFiles mismatch');
if (result.importMap === undefined) throw new Error('importMap missing');
if (JSON.stringify(result.files) !== JSON.stringify(scan.files)) throw new Error('files not verbatim');
if (JSON.stringify(result.importMap) !== JSON.stringify(imports.importMap)) throw new Error('importMap not verbatim');
for (const key of Object.keys(result.importMap)) {
  if (!result.files.some((f) => f.path === key)) throw new Error(`importMap key not in files: ${key}`);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/scan-result.json`, JSON.stringify(result, null, 2));
console.log(`written: files=${result.files.length} importMapKeys=${Object.keys(result.importMap).length} complexity=${result.estimatedComplexity}`);
