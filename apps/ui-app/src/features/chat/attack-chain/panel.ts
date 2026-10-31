// The side of the attack-chain dialog: the details of one node, the counts of the chain, and the words and colours they use.
// The markup is built here with every value escaped; the page only places it.

import { escapeHtml } from '../../../ui/format';

export interface NodeData {
  id?: unknown;
  type?: unknown;
  label?: unknown;
  originalLabel?: unknown;
  riskScore?: unknown;
  toolExecutionId?: unknown;
  metadata?: Record<string, unknown>;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ff0000',
  high: '#ff4444',
  medium: '#ff8800',
  low: '#ffbb00',
};

const TYPE_LABELS: Record<string, string> = {
  action: 'Action',
  vulnerability: 'Vulnerability',
  target: 'Target',
};

export function severityColor(severity: unknown): string {
  return SEVERITY_COLORS[String(severity ?? '').toLowerCase()] || '#666';
}

export function nodeTypeLabel(type: unknown): string {
  const key = String(type ?? '');
  return TYPE_LABELS[key] || key;
}

/** The counts line of the dialog: "N nodes, M edges", in the reader's language. */
export function statsText(chain: { nodes?: unknown[]; edges?: unknown[] }, t: (key: string, values: Record<string, unknown>) => string | undefined): string {
  const nodes = Array.isArray(chain.nodes) ? chain.nodes.length : 0;
  const edges = Array.isArray(chain.edges) ? chain.edges.length : 0;
  return t('attackChainModal.nodesEdges', { nodes, edges }) ?? `Nodes: ${nodes} | Edges: ${edges}`;
}

function item(label: string, value: string): string {
  return `
        <div class="node-detail-item">
            <strong>${label}:</strong> ${value}
        </div>
    `;
}

/** The details of one node: its identity and kind, then what its kind carries. */
export function nodeDetailHtml(node: NodeData): string {
  const metadata = node.metadata ?? {};
  const text = (value: unknown) => escapeHtml(String(value ?? ''));
  let html = `
        <div class="node-detail-item">
            <strong>Node ID:</strong> <code>${String(node.id ?? '')}</code>
        </div>
        <div class="node-detail-item">
            <strong>Type:</strong> ${nodeTypeLabel(node.type)}
        </div>
        <div class="node-detail-item">
            <strong>Label:</strong> ${text(node.originalLabel || node.label)}
        </div>
        <div class="node-detail-item">
            <strong>Risk score:</strong> ${String(node.riskScore)}/100
        </div>
    `;

  if (node.type === 'action') {
    if (metadata.tool_name) html += item('Tool name', `<code>${text(metadata.tool_name)}</code>`);
    if (metadata.tool_intent) html += item('Tool intent', `<span style="color: #0066ff; font-weight: bold;">${text(metadata.tool_intent)}</span>`);
    if (metadata.status === 'failed_insight') html += item('Execution status', '<span style="color: #ff9800; font-weight: bold;">Failed with leads</span>');
    if (metadata.ai_analysis) html += item('AI analysis', `<div class="node-detail-ai-analysis">${text(metadata.ai_analysis)}</div>`);
    if (Array.isArray(metadata.findings) && metadata.findings.length > 0) {
      html += `
                <div class="node-detail-item">
                    <strong>Key findings:</strong>
                    <ul style="margin: 5px 0; padding-left: 20px;">
                        ${metadata.findings.map(finding => `<li>${text(finding)}</li>`).join('')}
                    </ul>
                </div>
            `;
    }
  }

  if (node.type === 'target' && metadata.target) {
    html += item('Test target', `<code>${text(metadata.target)}</code>`);
  }

  if (node.type === 'vulnerability') {
    if (metadata.vulnerability_type) html += item('Vulnerability type', text(metadata.vulnerability_type));
    if (metadata.description) html += item('Description', text(metadata.description));
    if (metadata.severity) {
      html += item('Severity', `<span style="color: ${severityColor(metadata.severity)}; font-weight: bold;">${text(metadata.severity)}</span>`);
    }
    if (metadata.location) html += item('Location', `<code>${text(metadata.location)}</code>`);
  }

  if (node.toolExecutionId) html += item('Tool execution ID', `<code>${String(node.toolExecutionId)}</code>`);
  return html;
}
