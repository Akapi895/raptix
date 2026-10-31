import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAuthedTestApp } from "../support/build-test-app.js";
import { FakeAppConfigStore } from "../support/fake-app-config-store.js";

describe("config routes", () => {
  let app: FastifyInstance;
  let token: string;

  afterEach(async () => {
    await app.close();
    vi.unstubAllGlobals();
  });

  const auth = () => ({ authorization: `Bearer ${token}` });

  it("rejects an unauthenticated request", async () => {
    ({ app, token } = await buildAuthedTestApp());
    const response = await app.inject({ method: "GET", url: "/api/config" });
    expect(response.statusCode).toBe(401);
  });

  it("persists whatever is saved and reads it back faithfully (POST and PUT both set)", async () => {
    const appConfigStore = new FakeAppConfigStore();
    ({ app, token } = await buildAuthedTestApp({ appConfigStore }));
    const payload = { ai: { default_channel: "default", channels: { default: { provider: "openai", model: "gpt-5.4" } } } };
    const posted = await app.inject({ method: "POST", url: "/api/config", headers: auth(), payload });
    expect(posted.json()).toEqual(payload);
    const read = await app.inject({ method: "GET", url: "/api/config", headers: auth() });
    expect(read.json()).toEqual(payload);

    const updated = { ai: { default_channel: "default", channels: { default: { provider: "anthropic", model: "claude-opus-4-8" } } } };
    await app.inject({ method: "PUT", url: "/api/config", headers: auth(), payload: updated });
    const readAgain = await app.inject({ method: "GET", url: "/api/config", headers: auth() });
    expect(readAgain.json()).toEqual(updated);
  });

  it("apply is stubbed 501 -- store_model_in_db is false, no live admin API to push into", async () => {
    ({ app, token } = await buildAuthedTestApp());
    const response = await app.inject({ method: "POST", url: "/api/config/apply", headers: auth() });
    expect(response.statusCode).toBe(501);
  });

  it("list-models makes a real passthrough call with the operator-supplied credentials", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "gpt-5.4" }, { id: "gpt-5.5" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    ({ app, token } = await buildAuthedTestApp());
    const response = await app.inject({
      method: "POST",
      url: "/api/config/list-models",
      headers: auth(),
      payload: { base_url: "https://api.openai.com/v1", api_key: "sk-test" },
    });
    expect(response.json()).toEqual({ success: true, models: ["gpt-5.4", "gpt-5.5"], count: 2 });
    expect(fetchMock).toHaveBeenCalledWith("https://api.openai.com/v1/models", { headers: { Authorization: "Bearer sk-test" } });
  });

  it("list-models reports a real failure honestly, not a fabricated success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "invalid key" }), { status: 401 })),
    );
    ({ app, token } = await buildAuthedTestApp());
    const response = await app.inject({
      method: "POST",
      url: "/api/config/list-models",
      headers: auth(),
      payload: { base_url: "https://api.openai.com/v1", api_key: "bad" },
    });
    expect(response.json()).toEqual({ success: false, error: "HTTP 401", models: [] });
  });

  it("test-openai makes a real chat-completion probe and reports latency", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "pong" } }] }), { status: 200 })),
    );
    ({ app, token } = await buildAuthedTestApp());
    const response = await app.inject({
      method: "POST",
      url: "/api/config/test-openai",
      headers: auth(),
      payload: { base_url: "https://api.openai.com/v1", api_key: "sk-test", model: "gpt-5.4" },
    });
    expect(response.json()).toMatchObject({ success: true, model: "gpt-5.4" });
    expect(typeof response.json().latency_ms).toBe("number");
  });

  it("test-vision reports unsupported on a provider error, not a guessed success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: { message: "model does not support images" } }), { status: 400 })),
    );
    ({ app, token } = await buildAuthedTestApp());
    const response = await app.inject({
      method: "POST",
      url: "/api/config/test-vision",
      headers: auth(),
      payload: { base_url: "https://api.openai.com/v1", api_key: "sk-test", model: "gpt-5-nano" },
    });
    expect(response.json()).toMatchObject({ success: false, error: "model does not support images" });
  });

  it("test-typesafe is stubbed 501 -- no documented wire format for this protocol", async () => {
    ({ app, token } = await buildAuthedTestApp());
    const response = await app.inject({ method: "POST", url: "/api/config/test-typesafe", headers: auth(), payload: {} });
    expect(response.statusCode).toBe(501);
  });

  it("tools get/put/schema are stubbed 501 -- no HTTP introspection of Raptix's real tool catalog", async () => {
    ({ app, token } = await buildAuthedTestApp());
    const get = await app.inject({ method: "GET", url: "/api/config/tools", headers: auth() });
    expect(get.statusCode).toBe(501);
    const put = await app.inject({ method: "PUT", url: "/api/config/tools", headers: auth(), payload: {} });
    expect(put.statusCode).toBe(501);
    const schema = await app.inject({ method: "GET", url: "/api/config/tools/bash/schema", headers: auth() });
    expect(schema.statusCode).toBe(501);
  });
});
