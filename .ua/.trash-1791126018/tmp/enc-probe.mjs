import { readFileSync } from 'node:fs';
const raw = readFileSync('D:/.VTNet/redteam/raptix/.ua/intermediate/batch-111.json', 'utf-8');
const i = raw.indexOf('Evidence card');
const s = raw.slice(i, i + 60);
console.log('chars:', [...s].slice(0, 30).map((c) => c + '(U+' + c.codePointAt(0).toString(16) + ')').join(' '));
// write a probe file with known Vietnamese text via Node for console comparison
console.log('node-stdout-vietnamese-test: nhân, của, là, đặc biệt, tiếng Việt');
