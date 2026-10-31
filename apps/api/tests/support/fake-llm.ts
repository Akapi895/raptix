import type { LlmChannelConfig, LlmClient } from "../../src/adapters/llm/client.js";

/** Scriptable LLM fake: returns `response` verbatim (or throws `failure`) and records the prompts it saw. */
export class FakeLlm implements LlmClient {
  public response = "";
  public failure: Error | null = null;
  public readonly calls: { config: LlmChannelConfig; system: string; user: string; maxTokens: number }[] = [];

  public async complete(config: LlmChannelConfig, system: string, user: string, maxTokens: number): Promise<string> {
    this.calls.push({ config, system, user, maxTokens });
    if (this.failure !== null) throw this.failure;
    return this.response;
  }
}
