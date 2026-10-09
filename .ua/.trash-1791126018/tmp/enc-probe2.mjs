import { readFileSync } from 'node:fs';
const raw = readFileSync('D:/.VTNet/redteam/raptix/.ua/intermediate/batch-111.json', 'utf-8');
for (const word of ['của', 'c\u00E2\u0301u', 'reporter', 'sinh']) {
  const i = raw.indexOf(word);
  if (i >= 0) {
    const s = raw.slice(i, i + word.length);
    console.log(JSON.stringify(word), '->', [...s].map((c) => c + '(U+' + c.codePointAt(0).toString(16) + ')').join(' '));
    break;
  }
}
// Also check what is actually at the position after "human-readable "
const j = raw.indexOf('human-readable ');
const s2 = raw.slice(j + 15, j + 25);
console.log('after human-readable:', [...s2].map((c) => c + '(U+' + c.codePointAt(0).toString(16) + ')').join(' '));
