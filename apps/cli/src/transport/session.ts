import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The CLI's sign-in to a multi-user control plane. It holds the session cookie and the CSRF token the login returned,
 * and nothing else: no password is stored. The file is readable only by its owner.
 */
export interface ControlSession {
  cookie: string;
  csrfToken: string;
  /** The origin the session was issued for. The control plane refuses a request from any other origin. */
  origin: string;
}

const COOKIE_NAME = "raptix_web_session";

export function sessionFilePath(): string {
  return join(homedir(), ".raptix", "cli-session.json");
}

export async function loadSession(path: string = sessionFilePath()): Promise<ControlSession | null> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<ControlSession>;
    if (typeof parsed.cookie !== "string" || typeof parsed.csrfToken !== "string" || typeof parsed.origin !== "string") return null;
    return { cookie: parsed.cookie, csrfToken: parsed.csrfToken, origin: parsed.origin };
  } catch {
    return null;
  }
}

export async function saveSession(session: ControlSession, path: string = sessionFilePath()): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(session), { mode: 0o600 });
}

export async function clearSession(path: string = sessionFilePath()): Promise<void> {
  await rm(path, { force: true });
}

/**
 * Signs in with a username and password. The password is sent once to the login route and is not kept. The session
 * cookie comes from Set-Cookie; the CSRF token comes from the body.
 */
export async function signIn(baseUrl: string, username: string, password: string, fetchImpl: typeof fetch = fetch): Promise<ControlSession> {
  const origin = new URL(baseUrl).origin;
  const response = await fetchImpl(`${origin}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", origin },
    body: JSON.stringify({ username, password }),
    redirect: "error",
  });
  const body = (await response.json().catch(() => null)) as { authenticated?: unknown; csrfToken?: unknown } | null;
  if (response.status !== 200 || body?.authenticated !== true || typeof body.csrfToken !== "string") {
    throw new Error("Sign-in failed: check the username and password.");
  }
  const cookies = response.headers.getSetCookie?.() ?? [];
  const pair = cookies.map(c => c.split(";")[0]).find(c => c?.startsWith(`${COOKIE_NAME}=`));
  if (!pair) throw new Error("The control plane did not issue a session cookie.");
  return { cookie: pair, csrfToken: body.csrfToken, origin };
}
