import { buildApp, type BuildAppOptions } from "../../src/app.js";
import { hashPassword } from "../../src/security/password.js";
import { FakeAlertSubscriptionStore } from "./fake-alert-subscription-store.js";
import { FakeAssetStore } from "./fake-asset-store.js";
import { FakeAuthStore } from "./fake-auth-store.js";
import { FakeConversationStore } from "./fake-conversation-store.js";
import { FakeProjectStore } from "./fake-project-store.js";
import { FakeRuntime } from "./fake-runtime.js";
import { FakeSandbox } from "./fake-sandbox.js";
import { FakeVulnerabilityStore } from "./fake-vulnerability-store.js";

/** Every store defaults to a fresh fake; pass `overrides` to swap one in (e.g. a specific FakeRuntime instance). */
export function buildTestAppOptions(overrides: Partial<BuildAppOptions> = {}): BuildAppOptions {
  return {
    authStore: new FakeAuthStore(),
    sessionDurationHours: 12,
    projectStore: new FakeProjectStore(),
    conversationStore: new FakeConversationStore(),
    runtime: new FakeRuntime(),
    assetStore: new FakeAssetStore(),
    vulnerabilityStore: new FakeVulnerabilityStore(),
    alertSubscriptionStore: new FakeAlertSubscriptionStore(),
    sandbox: new FakeSandbox(),
    ...overrides,
  };
}

/** Builds the app with a default FakeAuthStore operator ("admin"/"pw") already created, and logs in once. */
export async function buildAuthedTestApp(overrides: Partial<BuildAppOptions> = {}) {
  const authStore = (overrides.authStore as FakeAuthStore | undefined) ?? new FakeAuthStore();
  await authStore.createOperator({ username: "admin", displayName: "Operator", passwordHash: hashPassword("pw") });
  const options = buildTestAppOptions({ ...overrides, authStore });
  const app = buildApp(options);
  await app.ready();
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "admin", password: "pw" } });
  return { app, token: login.json().token as string, options };
}
