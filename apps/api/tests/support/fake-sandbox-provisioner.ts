import type { SandboxProvisioner } from "../../src/adapters/sandbox/controller.js";

/** No-op provisioner that records every ensure() call; tests override `failure` to simulate provisioning failures. */
export class FakeSandboxProvisioner implements SandboxProvisioner {
  public ensured: string[] = [];
  public failure: Error | null = null;

  public async ensure(slug: string): Promise<void> {
    this.ensured.push(slug);
    if (this.failure !== null) throw this.failure;
  }
}
