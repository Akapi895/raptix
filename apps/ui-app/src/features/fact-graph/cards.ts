export const EDGE_COLORS: Record<string, string> = {
  discovered_on: '#4F46E5', leads_to: '#64748B', enables: '#E11D48', exploits: '#DC2626',
  depends_on: '#0D9488', contains: '#6366F1', part_of: '#6366F1', supports: '#94A3B8', links_vuln: '#BE123C',
};
type TypeStyle = { typeLabel: string; typeEn: string; accent: [string, string]; bgEnd: [string, string]; icon: string };
const styles: Record<string, TypeStyle> = {
  target: { typeLabel: 'Target', typeEn: 'TARGET', accent: ['#4F46E5', '#818cf8'], bgEnd: ['#F5F3FF', '#1e1b4b'], icon: 'target' },
  finding: { typeLabel: 'Finding', typeEn: 'FINDING', accent: ['#E11D48', '#fb7185'], bgEnd: ['#FFF1F2', '#3f1219'], icon: 'finding' },
  exploit: { typeLabel: 'Exploit', typeEn: 'EXPLOIT', accent: ['#B45309', '#fbbf24'], bgEnd: ['#FFFBEB', '#3b2712'], icon: 'vulnerability' },
  vulnerability: { typeLabel: 'Vulnerability', typeEn: 'VULN', accent: ['#9333EA', '#c084fc'], bgEnd: ['#F5F3FF', '#2e1065'], icon: 'vuln' },
  auth: { typeLabel: 'Auth', typeEn: 'AUTH', accent: ['#0D9488', '#2dd4bf'], bgEnd: ['#F0FDFA', '#0f2926'], icon: 'default' },
  infra: { typeLabel: 'Infrastructure', typeEn: 'INFRA', accent: ['#64748B', '#94a3b8'], bgEnd: ['#F8FAFC', '#1e293b'], icon: 'default' },
  chain: { typeLabel: 'Attack chain', typeEn: 'CHAIN', accent: ['#7C3AED', '#a78bfa'], bgEnd: ['#F5F3FF', '#2e1065'], icon: 'vulnerability' },
  poc: { typeLabel: 'POC', typeEn: 'POC', accent: ['#C2410C', '#fb923c'], bgEnd: ['#FFEDD5', '#3b2010'], icon: 'vulnerability' },
  business: { typeLabel: 'Business', typeEn: 'BUSINESS', accent: ['#0369A1', '#38bdf8'], bgEnd: ['#F0F9FF', '#0c2540'], icon: 'default' },
  missing: { typeLabel: 'Missing', typeEn: 'MISSING', accent: ['#CBD5E1', '#64748b'], bgEnd: ['#F1F5F9', '#1e293b'], icon: 'default' },
  note: { typeLabel: 'Note', typeEn: 'NOTE', accent: ['#94A3B8', '#94a3b8'], bgEnd: ['#F8FAFC', '#1e293b'], icon: 'default' },
};
export function nodeTheme(type: string, dark = false) {
  const style = styles[type] ?? { typeLabel: 'Note', typeEn: 'NOTE', accent: ['#94A3B8', '#94a3b8'], bgEnd: ['#F8FAFC', '#1e293b'], icon: 'default' };
  return { typeLabel: style.typeLabel, typeEn: style.typeEn, accent: style.accent[dark ? 1 : 0],
    bgStart: dark ? '#1e293b' : '#FFFFFF', bgEnd: style.bgEnd[dark ? 1 : 0],
    keyColor: dark ? '#94a3b8' : '#64748b', summaryColor: dark ? '#e5e7eb' : '#0f172a', icon: style.icon };
}
export const escapeXml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
function charWidth(ch: string, size: number, bold: boolean): number {
  const code = ch.codePointAt(0) ?? 0;
  const wide = (code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf) || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xff00 && code <= 0xffef) || /[·\uff1a\uff0c\u3002\uff1b\uff01\uff1f\u3010\u3011\uff08\uff09\u300a\u300b\u300c\u300d]/.test(ch);
  return size * (ch === ' ' ? 0.3 : wide ? 1 : 0.58) * (bold ? 1.05 : 1);
}
export function wrapTextLines(text: string, width: number, size: number, maxLines: number, bold: boolean): string[] {
  const chars = [...text.replace(/\s+/g, ' ').trim()], lines: string[] = [];
  const safe = Math.max(40, width - 4);
  let index = 0;
  while (index < chars.length && lines.length < maxLines) {
    let line = '', used = 0;
    while (index < chars.length) {
      const ch = chars[index] ?? '', next = charWidth(ch, size, bold);
      if (line && used + next > safe) break;
      line += ch; used += next; index++;
      if (used >= safe) break;
    }
    if (line) lines.push(line);
  }
  if (index < chars.length && lines.length) {
    let last = lines[lines.length - 1] ?? '';
    while (last.length > 1 && [...last + '…'].reduce((sum, ch) => sum + charWidth(ch, size, bold), 0) > safe) last = last.slice(0, -1);
    lines[lines.length - 1] = last + '…';
  }
  return lines.length ? lines : ['—'];
}
export function buildNodeCard(type: string, summary: string, confidence: string, factKey: string, dark: boolean) {
  confidence = (confidence || '').toLowerCase();
  const theme = nodeTheme(type, dark), width = type === 'target' ? 380 : 340, textWidth = width - 46 - 14 - 12;
  const statusBadge = confidence === 'tentative' ? 'Tentative' : confidence === 'deprecated' ? 'Deprecated' : '';
  const header = wrapTextLines(`${theme.typeEn} · ${theme.typeLabel}${statusBadge ? ' · ' + statusBadge : ''}`, textWidth, 11, 2, true);
  const keys = factKey.trim() ? wrapTextLines(factKey, textWidth, 10, 2, false) : [];
  const summaries = wrapTextLines(summary || '—', textWidth, 13, keys.length ? 3 : 4, true);
  const height = Math.min(176, Math.max(88, 14 + header.length * 16 + (keys.length ? 12 + keys.length * 14 : 6) + summaries.length * 18 + 14));
  const font = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif';
  const mono = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';
  const text = (lines: string[], y: number, size: number, lineHeight: number, color: string, weight: number, family: string) => lines.map((line, i) => `<text x="46" y="${y + i * lineHeight}" font-size="${size}" font-weight="${weight}" fill="${color}" fill-opacity="${size === 11 ? 0.88 : 1}" font-family='${family}'>${escapeXml(line)}</text>`).join('');
  const icons: Record<string, string> = {
    target: '<circle cx="12" cy="12" r="6" fill="none" stroke-width="2"/><circle cx="12" cy="12" r="2.5"/>',
    finding: '<circle cx="10" cy="10" r="6" fill="none" stroke-width="2"/><path d="M14.5 14.5L19 19" stroke-width="2"/>',
    vuln: '<path d="M12 2.5l7.5 3v6.2c0 4.6-3.1 8.1-7.5 9.3-4.4-1.2-7.5-4.7-7.5-9.3V5.5z" fill-opacity="0.12" stroke-width="2"/><path d="M12 8.5v4" stroke-width="2"/><circle cx="12" cy="15.5" r="1.1"/>',
    vulnerability: '<path d="M12 3l9 16H3z" fill="none" stroke-width="2"/><path d="M12 9v4" stroke-width="2"/><circle cx="12" cy="16" r="1"/>',
    default: '<circle cx="12" cy="12" r="5" opacity="0.85"/>',
  };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="${theme.bgStart}"/><stop offset="100%" stop-color="${theme.bgEnd}"/></linearGradient><clipPath id="textClip"><rect x="46" y="12" width="${width - 62}" height="${height - 24}"/></clipPath></defs><g${confidence === 'deprecated' ? ' opacity="0.55"' : ''}><rect x="0.75" y="0.75" width="${width - 1.5}" height="${height - 1.5}" rx="12" fill="url(#bg)" stroke="${theme.accent}" stroke-width="1.5" ${confidence === 'tentative' ? 'stroke-dasharray="8 5" stroke-opacity="0.9"' : 'stroke-opacity="0.72"'}/><g transform="translate(14,15)" fill="${theme.accent}" stroke="${theme.accent}">${icons[theme.icon]}</g><g clip-path="url(#textClip)">${text(header, 25, 11, 16, theme.accent, 700, font)}${text(keys, 14 + header.length * 16 + 16, 10, 14, theme.keyColor, 500, mono)}${text(summaries, 14 + header.length * 16 + (keys.length ? 12 + keys.length * 14 : 6) + 13, 13, 18, theme.summaryColor, 600, font)}</g></g></svg>`;
  return { theme, statusBadge, nodeWidth: width, nodeHeight: height, label: [header.join(' '), keys.join(' '), summaries.join(' ')].filter(Boolean).join('\n'), cardSvgUrl: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) };
}
