#!/usr/bin/env node
/**
 * One-shot headless render + client-side-execution probe.
 *
 * Usage (same stdin/stdout convention as playwright_real_chrome.js):
 *   echo '{"url":"http://target/vuln?x=<payload>"}' | node xss_probe.js
 *
 * Proves whether a payload already delivered via another tool call (e.g.
 * `http_request` storing it server-side, or the URL's own query string)
 * actually executes as JS in a rendered page — the bar a server-side
 * reflection/stored check (curl, http_request) cannot clear on its own.
 * Reuses the same node_modules this sandbox already installs for
 * playwright_real_chrome.js (sandbox.Dockerfile installs `playwright` into
 * this directory) — no new dependency, no image rebuild.
 *
 * NO-SITE-NAME RULE: this file must never branch on specific hostnames.
 * All site specifics come from the JSON input (url, evalExpression).
 *
 * Input fields (all but `url` optional):
 *   url            - page to render
 *   waitMs         - settle time after load for onerror/onload payloads to
 *                     fire (default 2000)
 *   evalExpression - JS source to evaluate in the page after settling
 *                     (e.g. "document.title" or a payload-set global like
 *                     "window.__xssProof"); result is JSON-serialized back
 *   timeoutMs      - navigation timeout (default 30000)
 *
 * Output (one JSON envelope on stdout, non-zero exit + stderr on failure):
 *   { status, finalUrl, consoleLines, evalResult, evalError, html }
 */

const { chromium } = require('playwright');

function readStdinJson() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); }
      catch (e) { reject(e); }
    });
    process.stdin.on('error', reject);
  });
}

// Drain stdout fully before exiting — process.exit() can truncate a large
// HTML payload because it does not wait for pending stdout I/O.
function writeStdoutAsync(payload) {
  return new Promise((resolve, reject) => {
    process.stdout.write(payload, (err) => (err ? reject(err) : resolve()));
  });
}

async function main() {
  const args = await readStdinJson();
  const url = args.url;
  if (!url) { process.stderr.write('missing url\n'); process.exitCode = 2; return; }

  const waitMs = args.waitMs ?? 2000;
  const timeoutMs = args.timeoutMs ?? 30000;
  const evalExpression = args.evalExpression;

  const consoleLines = [];
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: process.env.INSANE_CHROMIUM_PATH || undefined,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
    page.on('pageerror', (err) => consoleLines.push(`[pageerror] ${err.message || err}`));

    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.waitForTimeout(waitMs); // let onerror/onload/setTimeout payloads fire

    let evalResult = null;
    let evalError = null;
    if (evalExpression) {
      try {
        // eslint-disable-next-line no-eval -- intentional: caller-supplied probe expression
        evalResult = await page.evaluate((expr) => eval(expr), evalExpression);
      } catch (e) {
        evalError = `${e.name || 'Error'}: ${e.message || e}`;
      }
    }

    const html = await page.content();
    const payload = JSON.stringify({
      status: resp ? resp.status() : null,
      finalUrl: page.url(),
      consoleLines,
      evalResult,
      evalError,
      html,
    });
    await writeStdoutAsync(payload);
    process.exitCode = 0;
  } catch (e) {
    process.stderr.write(`${e.name || 'Error'}: ${e.message || e}\n`);
    process.exitCode = 1;
  } finally {
    try { if (browser) await browser.close(); } catch (_e) {}
  }
}

main();
