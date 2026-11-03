/** Bounded, read-only graph wire contract shared with the Python runtime. */
export interface GraphNode {
  kind?: string;
  key?: string;
  id?: string;
  label?: string;
  name?: string;
  props?: Record<string, unknown>;
  snapshot_hash?: string;
  [key: string]: unknown;
}

export interface GraphResult {
  nodes: GraphNode[];
  edges: Record<string, unknown>[];
  truncated: boolean;
}

export interface GraphRequest {
  graph: "runtime" | "reference";
  query_type: string;
  params: Record<string, unknown>;
}
