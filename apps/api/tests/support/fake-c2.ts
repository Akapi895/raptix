import type { C2Transport } from "../../src/adapters/c2/client.js";

export class FakeC2 implements C2Transport {
  public calls: { op: string; params: Record<string, unknown> }[] = [];
  public responses = new Map<string, Record<string, unknown>>();

  public async call(op: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    this.calls.push({ op, params });
    return this.responses.get(op) ?? {};
  }
}
