// Getting the attack chain out of the page: the shown nodes and edges are read from the graph, the report is built from
// them, and the file is handed to the browser. A PNG that cannot be drawn from the report falls back to the graph's own export.

import { buildAttackChainSvg, formatTimestamp, type ExportData, type ExportEdge, type ExportNode } from './export';

/** A node or edge of the graph, with the reads the export needs. */
export interface ExportElement {
  id(): string;
  data(key: string): unknown;
  style(name: string): unknown;
  position(): { x: number; y: number };
  length?: number;
}

export interface ExportEdgeElement extends ExportElement {
  source(): ExportElement;
  target(): ExportElement;
}

export interface ExportGraph {
  nodes(): { forEach(callback: (node: ExportElement) => void): void };
  edges(): { forEach(callback: (edge: ExportEdgeElement) => void): void };
  png(options: Record<string, unknown>): unknown;
}

export interface ExportDeps {
  graph(): ExportGraph | null;
  conversationId(): string | null;
  t(key: string, fallback: string): string;
  alert(message: string): void;
  setTimer(callback: () => void, ms: number): unknown;
  logError(message: string, error: unknown): void;
}

/** The export waits a moment so that the graph has finished its last frame. */
const EXPORT_DELAY_MS = 80;

const text = (value: unknown) => (value === undefined || value === null ? '' : String(value));

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : undefined) || String(error);
}

/** The two ends of an edge, or null when either is missing. */
function endsOf(edge: ExportEdgeElement): { source: ExportElement; target: ExportElement } | null {
  try {
    const source = edge.source();
    const target = edge.target();
    if (!source || !target || source.length === 0 || target.length === 0) return null;
    return { source, target };
  } catch {
    return null;
  }
}

/** The shown nodes and edges of the graph, as the report draws them. Hidden elements are left out. */
export function collectExportData(graph: ExportGraph): ExportData {
  const nodes: ExportNode[] = [];
  graph.nodes().forEach(node => {
    if (node.style('display') === 'none') return;
    const pos = node.position();
    nodes.push({
      id: node.id(),
      x: pos.x,
      y: pos.y,
      type: text(node.data('type')),
      riskScore: Number(node.data('riskScore') || 0),
      label: text(node.data('originalLabel') || node.data('label') || node.id()),
      metadata: (node.data('metadata') as Record<string, unknown> | undefined) ?? {},
    });
  });

  const edges: ExportEdge[] = [];
  graph.edges().forEach(edge => {
    if (edge.style('display') === 'none') return;
    const ends = endsOf(edge);
    if (!ends) return;
    const s = ends.source.position();
    const t = ends.target.position();
    edges.push({
      id: edge.id(),
      source: ends.source.id(),
      target: ends.target.id(),
      sx: s.x,
      sy: s.y,
      tx: t.x,
      ty: t.y,
      type: text(edge.data('type')) || 'leads_to',
    });
  });
  return { nodes, edges };
}

/** Hands a file to the browser as a download. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 150);
}

/** Draws the report onto a canvas at a scale, and reads it back as a PNG. */
export function svgToPng(svg: string, scale?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      const m = svg.match(/<svg[^>]*width="(\d+(?:\.\d+)?)"[^>]*height="(\d+(?:\.\d+)?)"/i);
      const w = m ? parseFloat(m[1] ?? '') : 1600;
      const h = m ? parseFloat(m[2] ?? '') : 900;
      const s = scale || Math.min(2.5, Math.max(1.5, 2000 / Math.max(w, h)));

      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(w * s);
          canvas.height = Math.round(h * s);
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Canvas unavailable');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(url);
          canvas.toBlob(pngBlob => {
            if (!pngBlob) reject(new Error('PNG generation failed'));
            else resolve(pngBlob);
          }, 'image/png', 0.95);
        } catch (err) {
          URL.revokeObjectURL(url);
          reject(err);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('SVG loading failed'));
      };
      img.src = url;
    } catch (e) {
      reject(e);
    }
  });
}

/** The graph's own PNG, used when the report cannot be drawn. */
function exportGraphPng(graph: ExportGraph, filename: string, deps: ExportDeps): void {
  try {
    const result = graph.png({ output: 'blob', bg: '#ffffff', full: true, scale: 2 });
    if (!result) {
      deps.alert('PNG export failed');
      return;
    }
    Promise.resolve(result as Blob | Promise<Blob>)
      .then(blob => downloadBlob(blob, filename))
      .catch(e => deps.alert('PNG export failed: ' + errorText(e)));
  } catch (e) {
    deps.alert('PNG export failed: ' + errorText(e));
  }
}

/** Exports the drawn chain as an SVG report or a PNG. With no chain drawn, the user is asked to load one first. */
export function exportChain(format: string, deps: ExportDeps): void {
  const graph = deps.graph();
  if (!graph) {
    deps.alert(deps.t('chat.pleaseLoadAttackChainFirst', 'Load an attack chain first'));
    return;
  }

  deps.setTimer(() => {
    try {
      const data = collectExportData(graph);
      // A filter that hides every node leaves nothing to report: the user is told so, which is not a failure to log.
      if (data.nodes.length === 0) {
        deps.alert(deps.t('chat.attackChainNothingToExport', 'No nodes to export under the current filter'));
        return;
      }
      const svg = buildAttackChainSvg(data, formatTimestamp(new Date()));
      const convId = deps.conversationId() || 'export';
      const stamp = Date.now();

      if (format === 'svg') {
        downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `attack-chain-${convId}-${stamp}.svg`);
      } else if (format === 'png') {
        const filename = `attack-chain-${convId}-${stamp}.png`;
        svgToPng(svg, 2)
          .then(png => downloadBlob(png, filename))
          .catch(err => {
            deps.logError('PNG export failed; falling back to the native Cytoscape export:', err);
            exportGraphPng(graph, filename, deps);
          });
      } else {
        deps.alert('Unsupported export format: ' + format);
      }
    } catch (error) {
      deps.logError('Export failed:', error);
      deps.alert('Export failed: ' + ((error instanceof Error && error.message) || 'Unknown error'));
    }
  }, EXPORT_DELAY_MS);
}
