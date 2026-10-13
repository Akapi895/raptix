import { readFileSync, writeFileSync } from 'node:fs';

const [scanPath, outPath] = process.argv.slice(2);
const scan = JSON.parse(readFileSync(scanPath, 'utf8'));
const payload = {
  projectRoot: 'D:\\.VTNet\\redteam\\raptix\\apps\\web-improve',
  files: scan.files.map((f) => ({ path: f.path, language: f.language, fileCategory: f.fileCategory })),
};
writeFileSync(outPath, JSON.stringify(payload, null, 2));
console.log(`wrote ${payload.files.length} files`);
