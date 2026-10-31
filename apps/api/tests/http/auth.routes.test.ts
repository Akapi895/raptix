import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { hashPassword } from "../../src/security/password.js";
import { buildTestAppOptions } from "../support/build-test-app.js";
import { FakeAuthStore } from "../support/fake-auth-store.js";

describe("auth routes", () => {
  let app: FastifyInstance;
  let store: FakeAuthStore;

  beforeEach(async () => {
    store = new FakeAuthStore();
    await store.createOperator({ username: "admin", displayName: "Operator", passwordHash: hashPassword("s3cret!") });
    app = buildApp(buildTestAppOptions({ authStore: store }));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  async function login(username: string, password: string) {
    return app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password } });
  }

  it("logs in with correct credentials and returns a T1_SessionPayload shape", async () => {
    const response = await login("admin", "s3cret!");
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      user: { username: "admin", display_name: "Operator" },
      roles: ["Administrator"],
      scope: "all",
    });
    expect(typeof body.token).toBe("string");
    expect(typeof body.expires_at).toBe("string");
    expect(body.session_duration_hr).toBe(12);
  });

  it("rejects an incorrect password with 401", async () => {
    const response = await login("admin", "wrong");
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "Incorrect password" });
  });

  it("rejects a missing password with 400", async () => {
    const response = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "admin" } });
    expect(response.statusCode).toBe(400);
  });

  it("rejects an unknown username the same way as a wrong password", async () => {
    const response = await login("nobody", "whatever");
    expect(response.statusCode).toBe(401);
  });

  it("validate without a bearer token is rejected", async () => {
    const response = await app.inject({ method: "GET", url: "/api/auth/validate" });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "Invalid session" });
  });

  it("validate with the session token from login succeeds", async () => {
    const { token } = (await login("admin", "s3cret!")).json();
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/validate",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().user.username).toBe("admin");
  });

  it("logout invalidates the session so a later validate fails", async () => {
    const { token } = (await login("admin", "s3cret!")).json();
    const logoutResponse = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(logoutResponse.statusCode).toBe(200);
    expect(logoutResponse.json()).toEqual({ message: "Signed out" });

    const validateResponse = await app.inject({
      method: "GET",
      url: "/api/auth/validate",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(validateResponse.statusCode).toBe(401);
  });

  it("change-password rejects a wrong old password", async () => {
    const { token } = (await login("admin", "s3cret!")).json();
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      headers: { authorization: `Bearer ${token}` },
      payload: { oldPassword: "nope", newPassword: "new-pass" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("change-password lets the new password log in afterwards", async () => {
    const { token } = (await login("admin", "s3cret!")).json();
    const changeResponse = await app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      headers: { authorization: `Bearer ${token}` },
      payload: { oldPassword: "s3cret!", newPassword: "new-pass" },
    });
    expect(changeResponse.statusCode).toBe(200);

    const oldLogin = await login("admin", "s3cret!");
    expect(oldLogin.statusCode).toBe(401);

    const newLogin = await login("admin", "new-pass");
    expect(newLogin.statusCode).toBe(200);
  });

  it("robot-binding routes are stubbed 501, not a fabricated success (ADR-0106 §2)", async () => {
    const { token } = (await login("admin", "s3cret!")).json();
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/robot-bindings",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(501);
  });
});
