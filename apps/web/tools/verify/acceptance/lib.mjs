// Shared helpers for the pre-Phase-C acceptance flows (test stack only). Each flow receives its connection from the
// fixture manifest and the environment; nothing here reads production settings. Writes go through the real API with the
// session of the actor that is allowed to make them, and persisted state is read back from the test database with psql.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

export function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      const next = argv[i + 1];
      args[argv[i].slice(2)] = next && !next.startsWith('--') ? next : true;
      if (next && !next.startsWith('--')) i += 1;
    }
  }
  return args;
}

/** Connection for a run: the app and API URLs come from the manifest's run, credentials from the environment or the hold file. */
export function loadConnection({ fixtures, app, api, holdFile }) {
  const manifest = JSON.parse(readFileSync(fixtures, 'utf8'));
  const hold = holdFile ? JSON.parse(readFileSync(holdFile, 'utf8')) : null;
  const appUrl = app ?? process.env.RAPTIX_VERIFY_APP ?? hold?.app;
  const apiUrl = api ?? hold?.api ?? appUrl;
  const db = process.env.RAPTIX_VERIFY_DB_CONTAINER ?? hold?.db ?? null;
  return {
    app: appUrl,
    api: apiUrl,
    db,
    project: manifest.project,
    finding: manifest.finding,
    report: manifest.report,
    asset: manifest.asset,
    owner: { label: 'owner', username: process.env.RAPTIX_VERIFY_USER ?? hold?.owner ?? 'verifier', password: process.env.RAPTIX_VERIFY_PASSWORD ?? hold?.adminPassword },
    reviewer: manifest.reviewer ?? hold?.reviewer,
    operator: manifest.operator ?? hold?.operator,
    viewer: manifest.viewer ?? hold?.viewer,
  };
}

/** A signed-in API session. The CSRF token is taken from the login response and sent with every write. */
export class ApiSession {
  constructor(api, label) {
    this.api = api;
    this.label = label;
    this.cookie = '';
    this.csrf = '';
  }

  async login(username, password) {
    const response = await fetch(`${this.api}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
    if (response.status !== 200) throw new Error(`login ${this.label}: HTTP ${response.status}`);
    this.cookie = response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
    this.csrf = (await response.json()).csrfToken;
    return this;
  }

  async call(method, endpoint, body) {
    const headers = { cookie: this.cookie };
    if (method !== 'GET') headers['x-csrf-token'] = this.csrf;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(this.api + endpoint, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { status: response.status, json, text, headers: response.headers };
  }
}

/** Reads one scalar row from the test database. The container and database are this run's only. */
export function dbScalar(container, sql) {
  if (!container) throw new Error('no test database container for this run');
  const result = spawnSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'verify', '-At', '-c', sql], { encoding: 'utf8', timeout: 20000 });
  if (result.status !== 0) throw new Error(`psql failed: ${result.stderr.trim().split('\n')[0]}`);
  return result.stdout.trim();
}

/** Accumulates the verdicts of one flow and writes them as JSON. A verdict is PASS, FAIL, NV or BLOCKED with its evidence. */
export class Recorder {
  constructor(workflow, outFile) {
    this.workflow = workflow;
    this.outFile = outFile;
    this.results = [];
  }

  async check(id, run) {
    try {
      const verdict = await run();
      this.results.push({ id, workflow: this.workflow, status: verdict.status ?? (verdict.ok ? 'PASS' : 'FAIL'), detail: verdict.detail ?? '', evidence: verdict.evidence ?? null });
    } catch (error) {
      this.results.push({ id, workflow: this.workflow, status: 'FAIL', detail: `could not run: ${String(error.message).split('\n')[0]}`, evidence: null });
    }
    const last = this.results[this.results.length - 1];
    console.log(`${last.status} ${last.id} ${last.detail}`);
  }

  note(id, status, detail) {
    this.results.push({ id, workflow: this.workflow, status, detail, evidence: null });
    console.log(`${status} ${id} ${detail}`);
  }

  save() {
    mkdirSync(path.dirname(this.outFile), { recursive: true });
    const counts = {};
    for (const row of this.results) counts[row.status] = (counts[row.status] ?? 0) + 1;
    writeFileSync(this.outFile, JSON.stringify({ workflow: this.workflow, generatedAt: new Date().toISOString(), counts, results: this.results }, null, 1));
    return counts;
  }
}
