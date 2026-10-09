import { readFileSync, writeFileSync } from 'node:fs';

const batchesJson = JSON.parse(readFileSync('D:/.VTNet/redteam/raptix/.ua/intermediate/batches.json', 'utf-8'));
const projectRoot = 'D:\\.VTNet\\redteam\\raptix';

for (const idx of [61, 62, 63, 64, 65]) {
  const batch = batchesJson.batches.find(b => b.batchIndex === idx);
  if (!batch) throw new Error(`batch ${idx} not found`);
  const input = {
    projectRoot,
    batchFiles: batch.files,
    batchImportData: batch.batchImportData,
  };
  const outPath = `D:/.VTNet/redteam/raptix/.ua/tmp/ua-file-analyzer-input-${idx}.json`;
  writeFileSync(outPath, JSON.stringify(input, null, 2), 'utf-8');
  console.log(`${outPath}: files=${batch.files.length}`);
}
