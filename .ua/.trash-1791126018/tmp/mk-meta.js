const fs = require('fs');
const inputs = [111,112,113,114,115];
const root = 'D:/.VTNet/redteam/raptix';
for (const idx of inputs) {
  const input = JSON.parse(fs.readFileSync(`D:/.VTNet/redteam/raptix/.ua/tmp/ua-file-analyzer-input-${idx}.json`, 'utf-8'));
  console.log(`=== BATCH ${idx} ===`);
  for (const f of input.batchFiles) {
    const abs = root + '/' + f.path;
    let info = '';
    try {
      const c = fs.readFileSync(abs, 'utf-8');
      if (f.language === 'json') {
        try {
          const j = JSON.parse(c);
          const parts = [];
          parts.push('name=' + (j.challenge_name || j.name || ''));
          parts.push('status=' + (j.passed !== undefined ? (j.passed ? 'PASS' : 'FAIL') : (j.status || '')));
          parts.push('level=' + (j.level || ''));
          parts.push('tags=' + JSON.stringify(j.tags || []));
          if (j.backfilled) parts.push('backfilled=true from=' + (j.backfill_source || '').slice(0, 60));
          if (j.flag_found !== undefined) parts.push('flag_found=' + j.flag_found);
          if (j.notes) parts.push('notes=' + j.notes.slice(0, 120));
          if (j.duration_seconds !== undefined) parts.push('dur=' + j.duration_seconds);
          if (j.duration_s !== undefined) parts.push('dur=' + j.duration_s);
          if (j.token_count !== null && j.token_count !== undefined) parts.push('tokens=' + j.token_count);
          if (j.error) parts.push('error=' + String(j.error).slice(0, 80));
          if (j.agent_summary) parts.push('agent=' + j.agent_summary.slice(0, 300).replace(/\n+/g, ' | '));
          info = parts.join(' ; ');
        } catch (e) { info = 'PARSE-ERROR ' + e.message; }
      } else {
        // markdown: grab heading + result + tags + key note lines
        const lines = c.split('\n');
        const head = lines.find(l => l.startsWith('#')) || '';
        const result = lines.find(l => /\*\*Result:\*\*|\*\*Status:\*\*/.test(l)) || '';
        const tags = lines.find(l => l.startsWith('**Tags:**')) || '';
        const back = lines.find(l => /backfill/i.test(l)) || '';
        const agline = lines.findIndex(l => l.includes('Agent Summary'));
        const agentNext = agline >= 0 ? lines.slice(agline + 1).filter(l => l.trim()).slice(0, 2).join(' | ') : '';
        const flagLine = lines.find(l => /FLAG\{/.test(l)) || '';
        info = [head, result, tags, back.slice(0, 140), 'FLAG=' + (flagLine ? 'yes' : 'no'), agentNext.slice(0, 250)].join(' ; ');
      }
    } catch (e) { info = 'READ-ERROR ' + e.message; }
    console.log(f.path + '\n    ' + info);
  }
}
