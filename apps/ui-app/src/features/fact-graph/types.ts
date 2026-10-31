// internal/database/project_fact_edges.go: ProjectFactGraph{Node,Edge}.
export interface GraphNode {
  id: string; fact_key: string; category: string; label: string; summary: string;
  confidence: string; type: string; pinned: boolean;
}
export interface GraphEdge { id: string; source: string; target: string; type: string; confidence: string }
export interface FactGraph { nodes: GraphNode[]; edges: GraphEdge[] }
export interface GraphOptions {
  emptyTitle?: string; emptyText?: string; emptySteps?: string[]; emptyActionLabel?: string;
  onEmptyAction?: () => void;
  onNodeSelect?: (key: string, data: GraphNodeData) => void;
  onEdgeSelect?: (id: string, data: GraphEdge) => void;
}
export interface GraphNodeData {
  id: string; factKey: string; category: string; type: string; typeLabel: string; typeEn: string;
  accentColor: string; statusBadge: string; confidence: string; summary: string;
  nodeWidth: number; nodeHeight: number; label: string; cardSvgUrl: string;
}
