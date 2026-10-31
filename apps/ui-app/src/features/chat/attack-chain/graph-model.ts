// The data of the attack-chain graph: the node labels (shortened for the graph), the colours and wording of each node
// kind and risk, the badge, the icon, and the elements the graph is built from. Pure; the view hands them to the graph.

export interface ChainNode {
  id: string;
  label?: string;
  type?: string;
  risk_score?: number;
  tool_execution_id?: string;
  metadata?: Record<string, unknown>;
}

export interface ChainEdge {
  id: string;
  source: string;
  target: string;
  type?: string;
  weight?: number;
}

export interface NodeTheme {
  typeLabel: string;
  typeEn: string;
  typeColor: string;
  accentColor: string;
  accentDark: string;
  bgGradientStart: string;
  bgGradientEnd: string;
  iconType: 'target' | 'action' | 'vulnerability' | 'default';
  labelTextColor: string;
}

/** A node label cut to the graph's width, preferably at a punctuation mark. */
export function truncateNodeLabel(label: string, isComplexGraph: boolean): string {
  const maxLength = isComplexGraph ? 18 : 22;
  if (label.length <= maxLength) return label;
  let truncated = label.substring(0, maxLength);
  const lastPunct = Math.max(
    truncated.lastIndexOf(','),
    truncated.lastIndexOf('.'),
    truncated.lastIndexOf(';'),
    truncated.lastIndexOf(' '),
    truncated.lastIndexOf('/'),
  );
  if (lastPunct > maxLength * 0.6) truncated = truncated.substring(0, lastPunct + 1);
  return truncated + '...';
}

/**
 * Shortens every node label for the graph. The page does this on the chain it received, so the shortened label is also
 * what the rest of the page (the details, the export) reads afterwards.
 */
export function shortenNodeLabels(nodes: ChainNode[], isComplexGraph: boolean): void {
  nodes.forEach(node => {
    if (node.label) node.label = truncateNodeLabel(node.label, isComplexGraph);
  });
}

function findingsOf(metadata: Record<string, unknown>): unknown[] {
  const findings = metadata.findings;
  return Array.isArray(findings) ? findings : [];
}

/** The wording and colours of a node: by kind, and for a vulnerability by its risk score. */
export function nodeTheme(node: ChainNode, isDark: boolean): NodeTheme {
  const riskScore = node.risk_score || 0;
  const nodeType = node.type || '';
  const metadata = node.metadata || {};
  let theme: NodeTheme = {
    typeLabel: 'Node', typeEn: 'NODE', typeColor: '#334155', accentColor: '#94a3b8', accentDark: '#475569',
    bgGradientStart: '#FFFFFF', bgGradientEnd: '#F8FAFC', iconType: 'default', labelTextColor: '#0F172A',
  };
  if (nodeType === 'target') {
    theme = { ...theme, typeLabel: 'Target', typeEn: 'TARGET', typeColor: '#312E81', accentColor: '#4F46E5', accentDark: '#3730A3', bgGradientEnd: '#F5F3FF', iconType: 'target' };
  } else if (nodeType === 'action') {
    const hasFindings = findingsOf(metadata).length > 0;
    const failedInsight = (metadata.status || '') === 'failed_insight';
    const productive = hasFindings && !failedInsight;
    theme = {
      ...theme,
      typeLabel: 'Action', typeEn: 'ACTION', iconType: 'action',
      ...(productive
        ? { typeColor: '#064E3B', accentColor: '#10B981', accentDark: '#047857', bgGradientEnd: '#ECFDF5' }
        : { typeColor: '#334155', accentColor: '#64748B', accentDark: '#475569', bgGradientEnd: '#F8FAFC' }),
    };
  } else if (nodeType === 'vulnerability') {
    const tier = riskScore >= 80
      ? { typeColor: '#881337', accentColor: '#E11D48', accentDark: '#BE123C', bgGradientEnd: '#FFF1F2' }
      : riskScore >= 60
        ? { typeColor: '#7C2D12', accentColor: '#EA580C', accentDark: '#C2410C', bgGradientEnd: '#FFF7ED' }
        : riskScore >= 40
          ? { typeColor: '#713F12', accentColor: '#CA8A04', accentDark: '#A16207', bgGradientEnd: '#FEFCE8' }
          : { typeColor: '#134E4A', accentColor: '#0D9488', accentDark: '#0F766E', bgGradientEnd: '#F0FDFA' };
    theme = { ...theme, typeLabel: 'Vulnerability', typeEn: 'VULNERABILITY', iconType: 'vulnerability', ...tier };
  }
  theme = { ...theme, bgGradientStart: '#FFFFFF', labelTextColor: '#0F172A' };

  if (isDark) {
    theme.labelTextColor = '#E5E7EB';
    theme.typeColor = '#E5E7EB';
    theme.bgGradientStart = '#111827';
    if (nodeType === 'target') {
      theme.bgGradientEnd = '#1E1B4B';
    } else if (nodeType === 'action') {
      theme.bgGradientEnd = theme.accentColor === '#10B981' ? '#052E2B' : '#172033';
    } else if (nodeType === 'vulnerability') {
      theme.bgGradientEnd = riskScore >= 80 ? '#3F101C' : riskScore >= 60 ? '#3B1D0D' : riskScore >= 40 ? '#3A2A0A' : '#063A36';
    } else {
      theme.bgGradientEnd = '#172033';
    }
  }
  return theme;
}

/** The short badge on a node's corner: its risk, its findings, or its place as the main target. */
export function nodeBadge(node: ChainNode): string {
  const riskScore = node.risk_score || 0;
  const metadata = node.metadata || {};
  if (node.type === 'vulnerability' && riskScore > 0) {
    const level = riskScore >= 80 ? 'Critical' : riskScore >= 60 ? 'High' : riskScore >= 40 ? 'Medium' : 'Low';
    return level + ' · ' + riskScore;
  }
  if (node.type === 'action') {
    const findings = findingsOf(metadata);
    if (findings.length > 0 && metadata.status !== 'failed_insight') return 'Found ' + findings.length;
    if (metadata.status === 'failed_insight') return 'Leads only';
    return '';
  }
  if (node.type === 'target') return 'Primary target';
  return '';
}

/** The icon of a node: a rounded gradient tile with a white glyph, as an SVG data URL. */
export function nodeIconDataUrl(iconType: NodeTheme['iconType'], color: string, colorDark: string): string {
  const paths: Record<NodeTheme['iconType'], string> = {
    target: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm0-14c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4z',
    action: 'M7 2v11h3v9l7-12h-4l4-8z',
    vulnerability: 'M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-1 6h2v6h-2V7zm0 8h2v2h-2v-2z',
    default: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
<defs>
<linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
<stop offset="0%" stop-color="${color}"/>
<stop offset="100%" stop-color="${colorDark}"/>
</linearGradient>
</defs>
<rect x="0" y="0" width="64" height="64" rx="14" fill="url(#g)"/>
<g transform="translate(14 14) scale(1.5)"><path d="${paths[iconType]}" fill="#FFFFFF"/></g>
</svg>`;
  try {
    return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
  } catch {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
}

export interface GraphElement {
  data: Record<string, unknown>;
}

export interface GraphBuild {
  elements: GraphElement[];
  validEdges: ChainEdge[];
  skipped: { edgeId: string; source: string; target: string; sourceExists: boolean; targetExists: boolean }[];
}

/** The elements of the graph: one per node, then one per edge whose two ends both exist. */
export function buildGraphElements(nodes: ChainNode[], edges: ChainEdge[], isDark: boolean): GraphBuild {
  const elements: GraphElement[] = [];
  nodes.forEach(node => {
    const theme = nodeTheme(node, isDark);
    elements.push({
      data: {
        id: node.id,
        label: node.label,
        originalLabel: node.label,
        type: node.type || '',
        typeLabel: theme.typeLabel,
        typeEn: theme.typeEn,
        typeColor: theme.typeColor,
        accentColor: theme.accentColor,
        accentDark: theme.accentDark,
        bgGradientStart: theme.bgGradientStart,
        bgGradientEnd: theme.bgGradientEnd,
        labelTextColor: theme.labelTextColor,
        iconDataUrl: nodeIconDataUrl(theme.iconType, theme.accentColor, theme.accentDark),
        badgeText: nodeBadge(node),
        riskScore: node.risk_score || 0,
        toolExecutionId: node.tool_execution_id || '',
        metadata: node.metadata || {},
      },
    });
  });

  const nodeIds = new Set(nodes.map(node => node.id));
  const validEdges: ChainEdge[] = [];
  const skipped: GraphBuild['skipped'] = [];
  edges.forEach(edge => {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      validEdges.push(edge);
      elements.push({
        data: { id: edge.id, source: edge.source, target: edge.target, type: edge.type || 'leads_to', weight: edge.weight || 1 },
      });
    } else {
      skipped.push({
        edgeId: edge.id,
        source: edge.source,
        target: edge.target,
        sourceExists: nodeIds.has(edge.source),
        targetExists: nodeIds.has(edge.target),
      });
    }
  });
  return { elements, validEdges, skipped };
}

/** Whether a graph is dense enough to need the compact layout. */
export function isComplexGraph(nodeCount: number, edgeCount: number): boolean {
  return nodeCount > 15 || edgeCount > 25;
}
