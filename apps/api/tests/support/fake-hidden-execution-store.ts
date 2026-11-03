import type { HiddenExecutionStore } from "../../src/db/hidden-execution-store.js";

export class FakeHiddenExecutionStore implements HiddenExecutionStore {
  private hidden = new Set<string>();

  public async hide(id: string): Promise<void> {
    this.hidden.add(id);
  }

  public async hideMany(ids: string[]): Promise<void> {
    for (const id of ids) this.hidden.add(id);
  }

  public async listHidden(): Promise<Set<string>> {
    return new Set(this.hidden);
  }
}
