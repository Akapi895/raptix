import type { AlertSubscriptionRecord, AlertSubscriptionStore } from "../../src/db/alert-subscription-store.js";

export class FakeAlertSubscriptionStore implements AlertSubscriptionStore {
  private value: AlertSubscriptionRecord = { enabled: false, minSeverity: "high" };

  public async get(): Promise<AlertSubscriptionRecord> {
    return this.value;
  }

  public async set(fields: AlertSubscriptionRecord): Promise<AlertSubscriptionRecord> {
    this.value = fields;
    return this.value;
  }
}
