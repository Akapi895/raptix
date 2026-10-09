#!/usr/bin/env node
// Repair CP1252 mojibake: file was written as UTF-8 but the original UTF-8
// bytes had been decoded as CP1252 chars first. Reverse that round-trip.
import { readFileSync, writeFileSync } from 'node:fs';

const CP1252_HIGH = [
  0x20ac, undefined, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
  0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, undefined, 0x017d, undefined,
  undefined, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, undefined, 0x017e, 0x0178,
];

const charToByte = new Map();
for (let b = 0xa0; b < 0x100; b++) charToByte.set(b, b);
for (let i = 0; i < 32; i++) {
  const ch = CP1252_HIGH[i];
  if (ch !== undefined) charToByte.set(ch, 0x80 + i);
}

const file = process.argv[2];
const text = readFileSync(file, 'utf-8');
const bytes = [];
for (const ch of text) {
  const cp = ch.codePointAt(0);
  if (cp < 0x80) bytes.push(cp);
  else if (charToByte.has(cp)) bytes.push(charToByte.get(cp));
  else {
    for (const b of Buffer.from(ch, 'utf-8')) bytes.push(b);
  }
}
const repaired = Buffer.from(bytes).toString('utf-8');
writeFileSync(file, repaired, 'utf-8');
console.log(`repaired ${file}: ${text.length} chars -> ${repaired.length} chars`);
