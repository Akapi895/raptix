/** LangGraph stream modes. The mutable tuple matches the SDK input type. */
export const STREAM_OPTIONS = {
  streamMode: ["values", "messages", "updates", "custom"] as ("values" | "messages" | "updates" | "custom")[],
  streamSubgraphs: true as const,
  streamResumable: true as const,
};
