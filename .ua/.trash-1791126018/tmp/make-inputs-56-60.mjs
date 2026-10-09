import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const UA = 'D:/.VTNet/redteam/raptix/.ua';
const ROOT = 'D:/.VTNet/redteam/raptix';
const batches = JSON.parse(readFileSync(join(UA, 'intermediate/batches.json'), 'utf-8'));
mkdirSync(join(UA, 'tmp'), { recursive: true });

for (const idx of [56, 57, 58, 59, 60]) {
  const b = batches.batches.find((x) => x.batchIndex === idx);
  if (!b) throw new Error(`batch ${idx} not found`);
  const input = {
    projectRoot: ROOT,
    batchFiles: b.files,
    batchImportData: b.batchImportData,
  };
  const out = join(UA, `tmp/ua-file-analyzer-input-${idx}.json`);
  writeFileSync(out, JSON.stringify(input, null, 2), 'utf-8');
  console.log(`wrote ${out} files=${b.files.length}`);
}
