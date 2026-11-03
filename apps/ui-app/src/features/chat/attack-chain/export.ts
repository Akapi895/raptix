// The attack-chain report as an SVG: a card with a header of counts, the graph of the nodes on the screen, a legend and a
// footer. Pure: it takes the nodes and edges already read from the graph, and returns the markup. The caller writes the file.

export interface ExportNode {
  id: string;
  x: number;
  y: number;
  type: string;
  riskScore: number;
  label: string;
  metadata: Record<string, unknown>;
}

export interface ExportEdge {
  id: string;
  source: string;
  target: string;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  type: string;
}

export interface ExportData {
  nodes: ExportNode[];
  edges: ExportEdge[];
}

interface Theme {
  primary: string;
  dark: string;
  text: string;
  label: string;
}

const TYPE_THEME = {
  'target': { primary: '#4F46E5', dark: '#3730A3', text: '#312E81', label: 'Target' },
  'action-success': { primary: '#10B981', dark: '#047857', text: '#064E3B', label: 'Action' },
  'action-neutral': { primary: '#64748B', dark: '#475569', text: '#334155', label: 'Action' },
  'vuln-critical': { primary: '#E11D48', dark: '#BE123C', text: '#881337', label: 'Vulnerability' },
  'vuln-high': { primary: '#EA580C', dark: '#C2410C', text: '#7C2D12', label: 'Vulnerability' },
  'vuln-med': { primary: '#CA8A04', dark: '#A16207', text: '#713F12', label: 'Vulnerability' },
  'vuln-low': { primary: '#0D9488', dark: '#0F766E', text: '#134E4A', label: 'Vulnerability' },
} satisfies Record<string, Theme>;

export type ThemeKey = keyof typeof TYPE_THEME;

/** The card size of every node in the report, which is larger than on the screen so that its details read. */
const CARD_W = 380;
const CARD_H = 140;

const CJK = /[\u4e00-\u9fa5\uff00-\uffef]/;
const charWidth = (ch: string) => (CJK.test(ch) ? 2 : 1);

export function escapeXml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** The text cut to a width, where a Chinese character counts as two. */
export function truncateToWidth(text: string, maxWidth: number): string {
  let width = 0;
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    width += charWidth(ch);
    if (width > maxWidth) break;
    out += ch;
  }
  return out;
}

/** A label broken into at most `maxLines` lines, preferably at a space; the last line ends with an ellipsis when cut. */
export function wrapLabel(label: string, maxChars: number, maxLines: number): string[] {
  if (!label) return [''];
  const text = String(label).replace(/\s+/g, ' ').trim();
  if (!text) return [''];
  const maxW = maxChars * 1.8;

  const lines: string[] = [];
  let buf = '';
  let bufW = 0;
  let lastSpaceIdx = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    const w = charWidth(ch);
    if (ch === ' ') lastSpaceIdx = buf.length;
    if (bufW + w > maxW) {
      let cut = buf;
      let rest = '';
      if (lastSpaceIdx > 0 && lastSpaceIdx >= buf.length - 10) {
        cut = buf.substring(0, lastSpaceIdx);
        rest = buf.substring(lastSpaceIdx + 1);
      }
      lines.push(cut);
      if (lines.length >= maxLines) {
        const last = lines[lines.length - 1] ?? '';
        lines[lines.length - 1] = truncateToWidth(last, maxW - 2) + '…';
        return lines;
      }
      buf = rest + ch;
      bufW = 0;
      for (let j = 0; j < buf.length; j++) bufW += charWidth(buf.charAt(j));
      lastSpaceIdx = -1;
    } else {
      buf += ch;
      bufW += w;
    }
  }
  if (buf) lines.push(buf);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[kept.length - 1] = truncateToWidth(kept[kept.length - 1] ?? '', maxW - 2) + '…';
    return kept;
  }
  return lines;
}

/** The icon of a node kind, as a path on a 24 by 24 grid. */
export function nodeIconPath(type: string): string {
  if (type === 'target') return 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm0-14c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4z';
  if (type === 'action') return 'M7 2v11h3v9l7-12h-4l4-8z';
  if (type === 'vulnerability') return 'M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-1 6h2v6h-2V7zm0 8h2v2h-2v-2z';
  return 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z';
}

/** The word for the risk of a vulnerability: Critical, High, Medium, Low, or nothing when there is no risk. */
export function riskLabel(score: number): string {
  if (score >= 80) return 'Critical';
  if (score >= 60) return 'High';
  if (score >= 40) return 'Medium';
  if (score > 0) return 'Low';
  return '';
}

/** The time of the report, to the minute, as local "YYYY-MM-DD HH:MM". */
export function formatTimestamp(date: Date): string {
  return date.getFullYear() + '-' +
    String(date.getMonth() + 1).padStart(2, '0') + '-' +
    String(date.getDate()).padStart(2, '0') + ' ' +
    String(date.getHours()).padStart(2, '0') + ':' +
    String(date.getMinutes()).padStart(2, '0');
}

function themeKeyFor(node: ExportNode): ThemeKey {
  if (node.type === 'target') return 'target';
  if (node.type === 'action') {
    const findings = Array.isArray(node.metadata.findings) ? node.metadata.findings : [];
    const productive = findings.length > 0 && node.metadata.status !== 'failed_insight';
    return productive ? 'action-success' : 'action-neutral';
  }
  if (node.type === 'vulnerability') {
    const score = node.riskScore || 0;
    if (score >= 80) return 'vuln-critical';
    if (score >= 60) return 'vuln-high';
    if (score >= 40) return 'vuln-med';
    return 'vuln-low';
  }
  return 'action-neutral';
}

/** Builds the report. The nodes are drawn at the report's card size; an empty chain cannot be reported. */
export function buildAttackChainSvg(input: ExportData, timestamp: string): string {
  if (input.nodes.length === 0) throw new Error('No data to export');
  const nodes = input.nodes.map(n => ({ ...n, w: CARD_W, h: CARD_H }));
  const edges = input.edges;

  // ==================== Bounding box and layout parameters ====================
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodes.forEach(n => {
    minX = Math.min(minX, n.x - n.w / 2);
    minY = Math.min(minY, n.y - n.h / 2);
    maxX = Math.max(maxX, n.x + n.w / 2);
    maxY = Math.max(maxY, n.y + n.h / 2);
  });

  const GRAPH_PAD = 100;                   // Inner padding of the graph area
  const HEADER_H = 128;                    // Header band
  const FOOTER_H = 56;                     // Footer band
  const LEGEND_W = 320;                    // Legend panel on the right
  const OUTER_PAD = 32;                    // Outermost padding

  const rawGraphW = (maxX - minX) + GRAPH_PAD * 2;
  const rawGraphH = (maxY - minY) + GRAPH_PAD * 2;

  const graphW = Math.max(rawGraphW, 900);
  const graphH = Math.max(rawGraphH, 620);

  const contentW = graphW + LEGEND_W + 36;
  const contentH = graphH + HEADER_H + FOOTER_H + 24;

  const totalW = contentW + OUTER_PAD * 2;
  const totalH = contentH + OUTER_PAD * 2;

  // Graph area position in card coordinates
  const graphAreaX = OUTER_PAD + 20;
  const graphAreaY = OUTER_PAD + HEADER_H;
  const graphAreaW = graphW - 4;
  const graphAreaH = contentH - HEADER_H - FOOTER_H;

  // Node coordinate mapping
  const graphCenterOffsetX = (graphAreaW - rawGraphW) / 2;
  const graphCenterOffsetY = (graphAreaH - rawGraphH) / 2;
  const graphOriginX = graphAreaX + GRAPH_PAD + graphCenterOffsetX - minX;
  const graphOriginY = graphAreaY + GRAPH_PAD + graphCenterOffsetY - minY;

  const legendX = graphAreaX + graphW + 16;

  // ==================== Statistics ====================
  const nodeCount = nodes.length;
  const edgeCount = edges.length;
  const vulnNodes = nodes.filter(n => n.type === 'vulnerability');
  const actionNodes = nodes.filter(n => n.type === 'action');
  const targetNodes = nodes.filter(n => n.type === 'target');
  const criticalCount = vulnNodes.filter(n => n.riskScore >= 80).length;
  const highCount = vulnNodes.filter(n => n.riskScore >= 60 && n.riskScore < 80).length;
  const medCount = vulnNodes.filter(n => n.riskScore >= 40 && n.riskScore < 60).length;
  const lowCount = vulnNodes.filter(n => n.riskScore > 0 && n.riskScore < 40).length;
  const ts = timestamp;

  const nodesMap = new Map(nodes.map(n => [n.id, n]));
  const parts: string[] = [];
  parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'Hiragino Sans GB', Roboto, Helvetica, Arial, sans-serif">`);

  // ==================== defs ====================
  parts.push(`<defs>`);
  parts.push(`<linearGradient id="ac-bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#FAFBFC"/>
        <stop offset="100%" stop-color="#F1F5F9"/>
    </linearGradient>`);
  parts.push(`<radialGradient id="ac-glow-1" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#6366F1" stop-opacity="0.12"/>
        <stop offset="100%" stop-color="#6366F1" stop-opacity="0"/>
    </radialGradient>`);
  parts.push(`<radialGradient id="ac-glow-2" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#EC4899" stop-opacity="0.08"/>
        <stop offset="100%" stop-color="#EC4899" stop-opacity="0"/>
    </radialGradient>`);
  parts.push(`<radialGradient id="ac-glow-3" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#06B6D4" stop-opacity="0.08"/>
        <stop offset="100%" stop-color="#06B6D4" stop-opacity="0"/>
    </radialGradient>`);
  parts.push(`<linearGradient id="ac-brand" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#4F46E5"/>
        <stop offset="50%" stop-color="#7C3AED"/>
        <stop offset="100%" stop-color="#EC4899"/>
    </linearGradient>`);
  parts.push(`<pattern id="ac-dot" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
        <circle cx="12" cy="12" r="1" fill="#0F172A" fill-opacity="0.06"/>
    </pattern>`);
  parts.push(`<filter id="ac-shadow-card" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-color="#0F172A" flood-opacity="0.06"/>
        <feDropShadow dx="0" dy="6" stdDeviation="12" flood-color="#0F172A" flood-opacity="0.08"/>
    </filter>`);
  parts.push(`<filter id="ac-shadow-icon" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#0F172A" flood-opacity="0.15"/>
    </filter>`);
  parts.push(`<filter id="ac-shadow-badge" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy="1.5" stdDeviation="2.5" flood-color="#0F172A" flood-opacity="0.18"/>
    </filter>`);

  const themeKeys = Object.keys(TYPE_THEME) as ThemeKey[];
  themeKeys.forEach(key => {
    const t = TYPE_THEME[key];
    parts.push(`<linearGradient id="ac-icon-grad-${key}" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="${t.primary}"/>
            <stop offset="100%" stop-color="${t.dark}"/>
        </linearGradient>`);
  });

  // Edges use gradients (source -> target)
  edges.forEach((e, idx) => {
    const sNode = nodesMap.get(e.source);
    const tNode = nodesMap.get(e.target);
    if (!sNode || !tNode) return;
    const sTheme = TYPE_THEME[themeKeyFor(sNode)];
    const tTheme = TYPE_THEME[themeKeyFor(tNode)];
    parts.push(`<linearGradient id="ac-edge-grad-${idx}" gradientUnits="userSpaceOnUse" x1="${e.sx}" y1="${e.sy}" x2="${e.tx}" y2="${e.ty}">
            <stop offset="0%" stop-color="${sTheme.primary}" stop-opacity="0.7"/>
            <stop offset="100%" stop-color="${tTheme.primary}" stop-opacity="0.9"/>
        </linearGradient>`);
  });

  themeKeys.forEach(key => {
    const t = TYPE_THEME[key];
    parts.push(`<marker id="ac-arrow-${key}" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="8" markerHeight="8" orient="auto-start-reverse" markerUnits="strokeWidth">
            <path d="M 0 0 L 12 6 L 0 12 L 3 6 Z" fill="${t.primary}"/>
        </marker>`);
  });

  parts.push(`</defs>`);

  // ==================== Background ====================
  parts.push(`<rect x="0" y="0" width="${totalW}" height="${totalH}" fill="url(#ac-bg)"/>`);
  parts.push(`<ellipse cx="${totalW * 0.1}" cy="${totalH * 0.15}" rx="${totalW * 0.4}" ry="${totalH * 0.4}" fill="url(#ac-glow-1)"/>`);
  parts.push(`<ellipse cx="${totalW * 0.9}" cy="${totalH * 0.85}" rx="${totalW * 0.35}" ry="${totalH * 0.35}" fill="url(#ac-glow-2)"/>`);
  parts.push(`<ellipse cx="${totalW * 0.5}" cy="${totalH * 0.1}" rx="${totalW * 0.3}" ry="${totalH * 0.3}" fill="url(#ac-glow-3)"/>`);

  // ==================== Main card ====================
  parts.push(`<rect x="${OUTER_PAD}" y="${OUTER_PAD}" width="${contentW}" height="${contentH}" rx="24" ry="24" fill="#FFFFFF" stroke="rgba(15,23,42,0.06)" stroke-width="1" filter="url(#ac-shadow-card)"/>`);

  // ==================== Header band ====================
  const tX = OUTER_PAD + 40;
  const tY = OUTER_PAD + 28;

  parts.push(`<g filter="url(#ac-shadow-icon)">`);
  parts.push(`<rect x="${tX - 4}" y="${tY}" width="48" height="48" rx="12" fill="url(#ac-brand)"/>`);
  parts.push(`<g transform="translate(${tX - 4 + 12}, ${tY + 12}) scale(0.9)">
        <path d="M12 2L3 7v10l9 5 9-5V7z" fill="none" stroke="#FFFFFF" stroke-width="1.8" stroke-linejoin="round"/>
        <path d="M10 7l-2 5h3l-1 4 4-5h-3l1-4z" fill="#FFFFFF"/>
    </g>`);
  parts.push(`</g>`);

  parts.push(`<text x="${tX + 56}" y="${tY + 26}" font-size="26" font-weight="800" fill="#0F172A" letter-spacing="-0.6px">Attack Chain Visualization Report</text>`);
  parts.push(`<text x="${tX + 56}" y="${tY + 50}" font-size="13" font-weight="500" fill="#64748B" letter-spacing="0.1px">Attack Chain Analysis · ${escapeXml(ts)}</text>`);

  // Top right: key stat pills (3)
  const kpiY = OUTER_PAD + 28;
  const kpiH = 48;
  const kpiGap = 12;
  const kpiW = 110;
  const kpiItems = [
    { label: 'Nodes', value: nodeCount, color: '#4F46E5' },
    { label: 'Edges', value: edgeCount, color: '#06B6D4' },
    { label: 'Critical vulns', value: criticalCount, color: criticalCount > 0 ? '#E11D48' : '#94A3B8' },
  ];
  const kpiXStart = OUTER_PAD + contentW - 40 - (kpiW * kpiItems.length + kpiGap * (kpiItems.length - 1));
  kpiItems.forEach((kpi, i) => {
    const kx = kpiXStart + i * (kpiW + kpiGap);
    parts.push(`<rect x="${kx}" y="${kpiY}" width="${kpiW}" height="${kpiH}" rx="12" fill="#FFFFFF" stroke="${kpi.color}" stroke-opacity="0.15" stroke-width="1"/>`);
    parts.push(`<rect x="${kx}" y="${kpiY + 10}" width="3" height="${kpiH - 20}" rx="1.5" fill="${kpi.color}"/>`);
    parts.push(`<text x="${kx + 16}" y="${kpiY + 26}" font-size="20" font-weight="800" fill="#0F172A" letter-spacing="-0.4px">${kpi.value}</text>`);
    parts.push(`<text x="${kx + 16}" y="${kpiY + 40}" font-size="10.5" font-weight="600" fill="#64748B" letter-spacing="0.4px">${escapeXml(kpi.label)}</text>`);
  });

  parts.push(`<line x1="${OUTER_PAD + 40}" y1="${OUTER_PAD + HEADER_H - 10}" x2="${OUTER_PAD + contentW - 40}" y2="${OUTER_PAD + HEADER_H - 10}" stroke="rgba(15,23,42,0.08)" stroke-width="1"/>`);

  // ==================== Graph area ====================
  parts.push(`<rect x="${graphAreaX}" y="${graphAreaY}" width="${graphAreaW}" height="${graphAreaH}" rx="18" fill="#FCFCFD" stroke="rgba(15,23,42,0.05)" stroke-width="1"/>`);
  parts.push(`<rect x="${graphAreaX}" y="${graphAreaY}" width="${graphAreaW}" height="${graphAreaH}" rx="18" fill="url(#ac-dot)" opacity="0.7"/>`);

  parts.push(`<g transform="translate(${graphOriginX}, ${graphOriginY})">`);

  // ---- Edges (gradients, soft curves) ----
  edges.forEach((e, idx) => {
    const sNode = nodesMap.get(e.source);
    const tNode = nodesMap.get(e.target);
    if (!sNode || !tNode) return;
    const targetKey = themeKeyFor(tNode);
    const tTheme = TYPE_THEME[targetKey];

    const dx = e.tx - e.sx;
    const dy = e.ty - e.sy;
    const mag = Math.sqrt(dx * dx + dy * dy) || 1;
    const offset = Math.min(80, mag * 0.25);
    const nx = -dy / mag;
    const ny = dx / mag;
    const cx = (e.sx + e.tx) / 2 + nx * offset;
    const cy = (e.sy + e.ty) / 2 + ny * offset;
    const shrink = 22;
    const ex = e.tx - (dx / mag) * shrink;
    const ey = e.ty - (dy / mag) * shrink;

    const strokeWidth = (e.type === 'discovers' || e.type === 'enables') ? 2.4 : 2;
    const strokeDash = e.type === 'targets' ? 'stroke-dasharray="10,5"' : '';

    const path = `M ${e.sx.toFixed(1)} ${e.sy.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`;
    parts.push(`<path d="${path}" fill="none" stroke="${tTheme.primary}" stroke-width="${strokeWidth + 4}" stroke-linecap="round" stroke-opacity="0.08" ${strokeDash}/>`);
    parts.push(`<path d="${path}" fill="none" stroke="url(#ac-edge-grad-${idx})" stroke-width="${strokeWidth}" stroke-linecap="round" ${strokeDash} marker-end="url(#ac-arrow-${targetKey})"/>`);
  });

  // ---- Nodes (large card design) ----
  nodes.forEach(n => {
    const themeKey = themeKeyFor(n);
    const theme: Theme = TYPE_THEME[themeKey];

    const x = n.x - n.w / 2;
    const y = n.y - n.h / 2;
    const r = 18;

    // Card body
    parts.push(`<g filter="url(#ac-shadow-card)">`);
    parts.push(`<rect x="${x}" y="${y}" width="${n.w}" height="${n.h}" rx="${r}" fill="#FFFFFF"/>`);
    parts.push(`</g>`);
    parts.push(`<rect x="${x}" y="${y}" width="${n.w}" height="${n.h}" rx="${r}" fill="${theme.primary}" fill-opacity="0.02"/>`);
    parts.push(`<rect x="${x}" y="${y}" width="${n.w}" height="${n.h}" rx="${r}" fill="none" stroke="${theme.primary}" stroke-opacity="0.18" stroke-width="1"/>`);
    parts.push(`<rect x="${x + 20}" y="${y}" width="${n.w - 40}" height="3" rx="1.5" fill="${theme.primary}" fill-opacity="0.5"/>`);

    const padX = 24;
    const padY = 22;

    // Top: large icon + type label + badge on the right
    const iconSize = 44;
    const iconX = x + padX;
    const iconY = y + padY;

    parts.push(`<g filter="url(#ac-shadow-icon)">`);
    parts.push(`<rect x="${iconX}" y="${iconY}" width="${iconSize}" height="${iconSize}" rx="12" fill="url(#ac-icon-grad-${themeKey})"/>`);
    parts.push(`</g>`);
    const iconScale = (iconSize * 0.55) / 24;
    const iconInnerOffset = (iconSize - 24 * iconScale) / 2;
    parts.push(`<g transform="translate(${iconX + iconInnerOffset}, ${iconY + iconInnerOffset}) scale(${iconScale.toFixed(3)})">
            <path d="${nodeIconPath(n.type)}" fill="#FFFFFF"/>
        </g>`);

    const typeTextX = iconX + iconSize + 14;
    const typeEn = n.type === 'target' ? 'TARGET' : n.type === 'action' ? 'ACTION' : n.type === 'vulnerability' ? 'VULNERABILITY' : (n.type || '').toUpperCase();
    parts.push(`<text x="${typeTextX}" y="${iconY + 14}" font-size="10" font-weight="700" fill="${theme.dark}" fill-opacity="0.75" letter-spacing="1.2px">${escapeXml(typeEn)}</text>`);
    parts.push(`<text x="${typeTextX}" y="${iconY + 34}" font-size="16" font-weight="700" fill="${theme.text}" letter-spacing="-0.2px">${escapeXml(theme.label)}</text>`);

    // Top-right badge
    const badgeY = iconY + 2;
    const badgeH = 26;
    if (n.type === 'vulnerability' && n.riskScore > 0) {
      const badgeText = `${riskLabel(n.riskScore)} · ${n.riskScore}`;
      const badgeW = 90;
      const bx = x + n.w - badgeW - padX;
      parts.push(`<g filter="url(#ac-shadow-badge)">`);
      parts.push(`<rect x="${bx}" y="${badgeY}" width="${badgeW}" height="${badgeH}" rx="${badgeH / 2}" fill="url(#ac-icon-grad-${themeKey})"/>`);
      parts.push(`<text x="${bx + badgeW / 2}" y="${badgeY + badgeH / 2 + 4.5}" text-anchor="middle" font-size="12" font-weight="700" fill="#FFFFFF" letter-spacing="0.2px">${escapeXml(badgeText)}</text>`);
      parts.push(`</g>`);
    } else if (n.type === 'action') {
      const m = n.metadata;
      const findings = Array.isArray(m.findings) ? m.findings : [];
      const isFailed = m.status === 'failed_insight';
      if (findings.length > 0 || isFailed) {
        const text = isFailed ? 'Leads only' : `Found ${findings.length}`;
        const badgeW = 70;
        const bx = x + n.w - badgeW - padX;
        parts.push(`<rect x="${bx}" y="${badgeY}" width="${badgeW}" height="${badgeH}" rx="${badgeH / 2}" fill="${theme.primary}" fill-opacity="0.12" stroke="${theme.primary}" stroke-opacity="0.4" stroke-width="1"/>`);
        parts.push(`<circle cx="${bx + 12}" cy="${badgeY + badgeH / 2}" r="3" fill="${theme.primary}"/>`);
        parts.push(`<text x="${bx + 20}" y="${badgeY + badgeH / 2 + 4.5}" font-size="11.5" font-weight="700" fill="${theme.dark}">${escapeXml(text)}</text>`);
      }
    } else if (n.type === 'target') {
      const badgeW = 60;
      const bx = x + n.w - badgeW - padX;
      parts.push(`<rect x="${bx}" y="${badgeY}" width="${badgeW}" height="${badgeH}" rx="${badgeH / 2}" fill="${theme.primary}" fill-opacity="0.12" stroke="${theme.primary}" stroke-opacity="0.4" stroke-width="1"/>`);
      parts.push(`<text x="${bx + badgeW / 2}" y="${badgeY + badgeH / 2 + 4.5}" text-anchor="middle" font-size="11.5" font-weight="700" fill="${theme.dark}" letter-spacing="0.3px">Primary target</text>`);
    }

    // Main title
    const contentTopY = iconY + iconSize + 18;
    const titleFontSize = 16;
    const titleLineH = titleFontSize + 6;
    const contentAvailW = n.w - padX * 2;
    const charsPerLine = Math.max(10, Math.floor(contentAvailW / (titleFontSize * 0.58)));
    const titleLines = wrapLabel(n.label, charsPerLine, 2);
    titleLines.forEach((ln, idx) => {
      parts.push(`<text x="${x + padX}" y="${contentTopY + idx * titleLineH}" font-size="${titleFontSize}" font-weight="700" fill="#0F172A" letter-spacing="-0.2px">${escapeXml(ln)}</text>`);
    });

    // Bottom meta bar
    const metaY = y + n.h - 22;
    parts.push(`<line x1="${x + padX}" y1="${metaY - 10}" x2="${x + n.w - padX}" y2="${metaY - 10}" stroke="rgba(15,23,42,0.06)" stroke-width="1"/>`);

    const metaItems = metaItemsFor(n);
    let metaX = x + padX;
    metaItems.forEach((mi, idx) => {
      if (idx > 0) {
        parts.push(`<circle cx="${metaX + 6}" cy="${metaY}" r="1.2" fill="#CBD5E1"/>`);
        metaX += 14;
      }
      const path = META_ICON_PATHS[mi.icon];
      parts.push(`<g transform="translate(${metaX}, ${metaY - 7}) scale(${(13 / 24).toFixed(3)})">
                <path d="${path}" fill="${theme.primary}" fill-opacity="0.8"/>
            </g>`);
      metaX += 18;
      parts.push(`<text x="${metaX}" y="${metaY + 3}" font-size="11.5" font-weight="500" fill="#64748B">${escapeXml(mi.text)}</text>`);
      metaX += mi.text.length * 6.5;
    });
  });

  parts.push(`</g>`);

  // ==================== Legend (right) ====================
  const lx = legendX;
  const ly = graphAreaY;
  const lw = LEGEND_W - 16;
  const lh = graphAreaH;

  parts.push(`<rect x="${lx}" y="${ly}" width="${lw}" height="${lh}" rx="18" fill="#FFFFFF" stroke="rgba(15,23,42,0.06)" stroke-width="1"/>`);
  parts.push(`<rect x="${lx + 16}" y="${ly}" width="${lw - 32}" height="3" rx="1.5" fill="url(#ac-brand)"/>`);

  let curY = ly + 26;

  parts.push(`<text x="${lx + 24}" y="${curY}" font-size="10.5" font-weight="800" fill="#64748B" letter-spacing="1.5px">NODE TYPES</text>`);
  curY += 22;
  const typeSummary: { key: ThemeKey; count: number; text: string }[] = [
    { key: 'target', count: targetNodes.length, text: 'Target' },
    { key: 'action-success', count: actionNodes.filter(a => { const m = a.metadata; return Array.isArray(m.findings) && m.findings.length > 0 && m.status !== 'failed_insight'; }).length, text: 'Action (with findings)' },
    { key: 'action-neutral', count: actionNodes.filter(a => { const m = a.metadata; const f = Array.isArray(m.findings) ? m.findings : []; return f.length === 0 || m.status === 'failed_insight'; }).length, text: 'Action (other)' },
    { key: 'vuln-critical', count: criticalCount, text: 'Critical vulnerability' },
    { key: 'vuln-high', count: highCount, text: 'High-risk vulnerability' },
    { key: 'vuln-med', count: medCount, text: 'Medium-risk vulnerability' },
    { key: 'vuln-low', count: lowCount, text: 'Low-risk vulnerability' },
  ];
  typeSummary.forEach(item => {
    const t = TYPE_THEME[item.key];
    if (item.count === 0) return;
    parts.push(`<rect x="${lx + 24}" y="${curY - 10}" width="14" height="14" rx="4" fill="${t.primary}"/>`);
    parts.push(`<text x="${lx + 46}" y="${curY + 1}" font-size="12.5" font-weight="500" fill="#334155">${escapeXml(item.text)}</text>`);
    parts.push(`<text x="${lx + lw - 24}" y="${curY + 1}" font-size="12.5" font-weight="700" fill="#0F172A" text-anchor="end">${item.count}</text>`);
    curY += 22;
  });
  curY += 10;

  parts.push(`<text x="${lx + 24}" y="${curY}" font-size="10.5" font-weight="800" fill="#64748B" letter-spacing="1.5px">CONNECTIONS</text>`);
  curY += 22;
  const lineItems = [
    { label: 'Action finds vulnerability', color: '#4F46E5', dash: '' },
    { label: 'Enables / contributes to', color: '#E11D48', dash: '' },
    { label: 'Logical sequence', color: '#64748B', dash: '' },
    { label: 'Targets', color: '#4F46E5', dash: '6,3' },
  ];
  lineItems.forEach(l => {
    const dashAttr = l.dash ? `stroke-dasharray="${l.dash}"` : '';
    parts.push(`<line x1="${lx + 24}" y1="${curY - 3}" x2="${lx + 62}" y2="${curY - 3}" stroke="${l.color}" stroke-width="2.4" stroke-linecap="round" ${dashAttr}/>`);
    parts.push(`<polygon points="${lx + 62},${curY - 6} ${lx + 68},${curY - 3} ${lx + 62},${curY}" fill="${l.color}"/>`);
    parts.push(`<text x="${lx + 78}" y="${curY + 1}" font-size="12.5" font-weight="500" fill="#334155">${escapeXml(l.label)}</text>`);
    curY += 24;
  });
  curY += 10;

  parts.push(`<text x="${lx + 24}" y="${curY}" font-size="10.5" font-weight="800" fill="#64748B" letter-spacing="1.5px">RISK LEVELS</text>`);
  curY += 22;
  const riskBar = [
    { label: 'Critical', range: '80-100', color: '#E11D48' },
    { label: 'High', range: '60-79', color: '#EA580C' },
    { label: 'Medium', range: '40-59', color: '#CA8A04' },
    { label: 'Low', range: '0-39', color: '#0D9488' },
  ];
  riskBar.forEach(r => {
    parts.push(`<rect x="${lx + 24}" y="${curY - 10}" width="46" height="18" rx="9" fill="${r.color}"/>`);
    parts.push(`<text x="${lx + 47}" y="${curY + 2}" text-anchor="middle" font-size="10.5" font-weight="700" fill="#FFFFFF" letter-spacing="0.3px">${escapeXml(r.label)}</text>`);
    parts.push(`<text x="${lx + 80}" y="${curY + 1}" font-size="12" font-weight="500" fill="#64748B">Score ${escapeXml(r.range)}</text>`);
    curY += 26;
  });

  // ==================== Footer band ====================
  const fY = OUTER_PAD + contentH - FOOTER_H;
  parts.push(`<line x1="${OUTER_PAD + 40}" y1="${fY + 16}" x2="${OUTER_PAD + contentW - 40}" y2="${fY + 16}" stroke="rgba(15,23,42,0.06)" stroke-width="1"/>`);
  parts.push(`<circle cx="${OUTER_PAD + 44}" cy="${fY + 34}" r="5" fill="url(#ac-brand)"/>`);
  parts.push(`<text x="${OUTER_PAD + 56}" y="${fY + 38}" font-size="11.5" font-weight="600" fill="#64748B">Raptix <tspan fill="#94A3B8" font-weight="500">· Attack Chain Visualization Report</tspan></text>`);
  parts.push(`<text x="${OUTER_PAD + contentW - 40}" y="${fY + 38}" font-size="11.5" font-weight="500" fill="#94A3B8" text-anchor="end">${escapeXml(ts)}</text>`);

  parts.push(`</svg>`);
  return parts.join('\n');
}

interface MetaItem {
  icon: keyof typeof META_ICON_PATHS;
  text: string;
}

const META_ICON_PATHS = {
  'loc': 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z',
  'tool': 'M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z',
  'aim': 'M12 2L4 5v6c0 5.5 3.8 10.7 8 12 4.2-1.3 8-6.5 8-12V5l-8-3zm4 10H8V9h3V7l3 3-3 3v-1z',
  'shield': 'M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.4-1.4 2.6 2.6 6.6-6.6L18 9l-8 8z',
  'alert': 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z',
  'hash': 'M20 9h-4.5l.9-4h-2l-.9 4H9l.9-4H8l-.9 4H3v2h3.7l-1 4H2v2h3.3l-.9 4h2l.9-4H12l-.9 4h2l.9-4H19v-2h-4.7l1-4H20V9zm-6.3 6H9l1-4h4.7l-1 4z',
} as const;

/** The short facts shown under the title of a node: its target, its tool and intent, its type and severity. */
function metaItemsFor(n: ExportNode): MetaItem[] {
  const items: MetaItem[] = [];
  const m = n.metadata;
  if (n.type === 'target') {
    const tgt = m.target ? String(m.target) : null;
    if (tgt) items.push({ icon: 'loc', text: truncateToWidth(tgt, 26) });
  } else if (n.type === 'action') {
    const toolName = m.tool_name ? String(m.tool_name) : '';
    if (toolName) items.push({ icon: 'tool', text: truncateToWidth(toolName, 20) });
    const intent = m.tool_intent ? String(m.tool_intent) : '';
    if (intent) items.push({ icon: 'aim', text: truncateToWidth(intent, 22) });
  } else if (n.type === 'vulnerability') {
    const vt = m.vulnerability_type ? String(m.vulnerability_type) : '';
    if (vt) items.push({ icon: 'shield', text: truncateToWidth(vt, 22) });
    const sev = m.severity ? String(m.severity) : '';
    if (sev) items.push({ icon: 'alert', text: truncateToWidth(sev, 12) });
  }
  if (items.length === 0) items.push({ icon: 'hash', text: truncateToWidth(n.id || '', 20) });
  return items;
}
