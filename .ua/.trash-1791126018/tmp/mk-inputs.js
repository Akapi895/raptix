const fs = require('fs');
const path = require('path');
const batches = JSON.parse(fs.readFileSync('D:/.VTNet/redteam/raptix/.ua/intermediate/batches.json', 'utf-8'));
const idxs = [111, 112, 113, 114, 115];
const tmpDir = 'D:/.VTNet/redteam/raptix/.ua/tmp';
fs.mkdirSync(tmpDir, { recursive: true });
for (const idx of idxs) {
  const b = batches.batches.find(x => x.batchIndex === idx);
  if (!b) { console.error('MISSING batch ' + idx); continue; }
  const input = {
    projectRoot: 'D:/.VTNet/redteam/raptix',
    batchFiles: b.files,
    batchImportData: b.batchImportData,
  };
  const out = path.join(tmpDir, `ua-file-analyzer-input-${idx}.json`);
  fs.writeFileSync(out, JSON.stringify(input, null, 2), 'utf-8');
  console.log(`${idx}: files=${b.files.length} imports=${Object.keys(b.batchImportData).length} -> ${out}`);
}
