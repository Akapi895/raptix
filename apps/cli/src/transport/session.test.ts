import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clearSession, loadSession, saveSession, signIn } from "./session.js";
import { FacadeClient } from "./facadeClient.js";

const folder = () => mkdtemp(join(tmpdir(), "raptix-session-"));

describe("CLI sign-in session", () => {
  it("stores the session in an owner-only file and reads it back", async () => {
    const path = join(await folder(), "cli-session.json");
    await saveSession({ cookie: "raptix_web_session=abc", csrfToken: "csrf-1", origin: "http://127.0.0.1:3001" }, path);
    expect(await loadSession(path)).toEqual({ cookie: "raptix_web_session=abc", csrfToken: "csrf-1", origin: "http://127.0.0.1:3001" });
    if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readFile(path, "utf8")).not.toContain("password");
  });

  it("returns null for a missing or malformed file and clears a stored one", async () => {
    const path = join(await folder(), "cli-session.json");
    expect(await loadSession(path)).toBeNull();
    await saveSession({ cookie: "c", csrfToken: "t", origin: "http://x" }, path);
    await clearSession(path);
    expect(await loadSession(path)).toBeNull();
  });

  it("signs in through the login route with the origin, and keeps only the cookie and the CSRF token", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ authenticated: true, csrfToken: "csrf-9" }), {
        status: 200,
        headers: { "content-type": "application/json", "set-cookie": "raptix_web_session=tok; Path=/; HttpOnly" },
      });
    }) as typeof fetch;
    const session = await signIn("http://127.0.0.1:3001/", "admin", "secret", fetchImpl);
    expect(calls[0]?.url).toBe("http://127.0.0.1:3001/api/auth/login");
    expect((calls[0]?.init.headers as Record<string, string>).origin).toBe("http://127.0.0.1:3001");
    expect(session).toEqual({ cookie: "raptix_web_session=tok", csrfToken: "csrf-9", origin: "http://127.0.0.1:3001" });
    expect(JSON.stringify(session)).not.toContain("secret");
  });

  it("refuses a failed sign-in without naming the password", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: { code: "unauthorized" } }), { status: 401 })) as typeof fetch;
    await expect(signIn("http://127.0.0.1:3001", "admin", "wrong", fetchImpl)).rejects.toThrow("Sign-in failed");
  });

  it("sends the cookie and origin on reads, and the CSRF token on writes, once a session is configured", async () => {
    const seen: RequestInit[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      seen.push(init);
      return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const client = new FacadeClient({ baseUrl: "http://127.0.0.1:3001", fetchImpl, session: { cookie: "raptix_web_session=tok", csrfToken: "csrf-9", origin: "http://127.0.0.1:3001" } });
    await client.listProjects();
    const read = seen[0]?.headers as Record<string, string>;
    expect(read.cookie).toBe("raptix_web_session=tok");
    expect(read.origin).toBe("http://127.0.0.1:3001");
    expect(read["x-csrf-token"]).toBeUndefined();
  });

  it("sends no credentials when no session is configured", async () => {
    const seen: RequestInit[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      seen.push(init);
      return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    await new FacadeClient({ baseUrl: "http://127.0.0.1:8081", fetchImpl }).listProjects();
    expect((seen[0]?.headers as Record<string, string>).cookie).toBeUndefined();
  });
});
