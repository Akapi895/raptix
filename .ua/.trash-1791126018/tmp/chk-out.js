const fs = require('fs');
for (const idx of [111,112,113,114,115]) {
  const o = JSON.parse(fs.readFileSync(`D:/.VTNet/redteam/raptix/.ua/tmp/ua-file-analyzer-output-${idx}.json`, 'utf-8'));
  console.log(`batch ${idx}: analyzed=${o.filesAnalyzed} skipped=${o.filesSkipped.length} unreadable=${o.filesUnreadable.length} outcomes=${JSON.stringify(o.analysisOutcomes)}`);
  const r0 = o.results[0];
  console.log(`  sample keys: ${Object.keys(r0).join(',')}`);
  console.log(`  sample file: ${r0.filePath ?? r0.path} -> symbols: ${(r0.analysis?.symbols||[]).length}, imports: ${(r0.analysis?.imports||[]).length}`);
}
