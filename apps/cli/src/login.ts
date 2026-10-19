#!/usr/bin/env node
import { createInterface } from "node:readline";
import { resolveControlUrl } from "./utils/apiUrl.js";
import { clearSession, saveSession, sessionFilePath, signIn } from "./transport/session.js";

// Signs the CLI in to the control plane (multi-user mode) and stores the session, or signs it out.
//   node dist/login.js --user <name>     prompts for the password without echo
//   node dist/login.js --logout          removes the stored session
// The control URL comes from RAPTIX_CONTROL_URL (for example the web UI address, which proxies /api).

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readHidden(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  let muted = false;
  // Suppress echo while the password is typed; the prompt itself is written before muting starts.
  (rl as unknown as { _writeToOutput: (text: string) => void })._writeToOutput = (text: string) => {
    if (!muted) process.stdout.write(text);
  };
  return new Promise(resolve => {
    rl.question(prompt, answer => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

async function main(): Promise<number> {
  if (process.argv.includes("--logout")) {
    await clearSession();
    process.stdout.write(`Signed out. Removed ${sessionFilePath()}.\n`);
    return 0;
  }
  const user = argValue("--user")?.trim();
  if (!user) {
    process.stderr.write("Usage: login.js --user <name>   or   login.js --logout\n");
    return 2;
  }
  const password = await readHidden(`Password for ${user}: `);
  try {
    const session = await signIn(resolveControlUrl(), user, password);
    await saveSession(session);
    process.stdout.write(`Signed in. Session stored at ${sessionFilePath()}.\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

process.exitCode = await main();
