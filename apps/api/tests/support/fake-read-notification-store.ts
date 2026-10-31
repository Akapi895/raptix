import type { ReadNotificationStore } from "../../src/db/read-notification-store.js";

export class FakeReadNotificationStore implements ReadNotificationStore {
  private read = new Set<string>();

  public async markRead(ids: string[]): Promise<void> {
    for (const id of ids) this.read.add(id);
  }

  public async listRead(): Promise<Set<string>> {
    return new Set(this.read);
  }
}
