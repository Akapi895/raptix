// WF-08 · Reports and export content: a report that selects a confirmed finding exports in each format with the title, the
// summary and the selected finding in the file itself; the digest in the response matches the bytes; a viewer can export;
// an outsider cannot; an unknown format is refused. Test stack only; API reads and writes only.
// Usage: node tools/verify/acceptance/wf-report-export.mjs --fixtures <manifest.json> --hold <hold.json> --out <result.json>
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadConnection, parseArgs, ApiSession, Recorder } from './lib.mjs';

const args = parseArgs(process.argv);
const conn = loadConnection({ fixtures: args.fixtures, holdFile: args.hold, app: args.app, api: args.api });
const outFile = args.out ?? 'wf-report-export.json';
const recorder = new Recorder('WF-08 reports and export content', outFile);
const stamp = Date.now().toString(36);
const project = conn.project;
const title = `Export check ${stamp}`;
const summary = `Summary written for the export check ${stamp}.`;
// The seeded confirmed finding of the stack (tools/verify/stack.mjs).
const FINDING_TITLE = 'Stack verification finding';
// Windows' bsdtar reads zip archives; a Git-for-Windows tar on the PATH does not.
const TAR = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
const scratch = path.join(path.dirname(path.resolve(outFile)), `wf-report-export-${stamp}`);
mkdirSync(scratch, { recursive: true });

const sessions = {
  operator: await new ApiSession(conn.api, 'operator').login(conn.operator.username, conn.operator.password),
  viewer: await new ApiSession(conn.api, 'viewer').login(conn.viewer.username, conn.viewer.password),
};
const owner = await new ApiSession(conn.api, 'owner').login(conn.owner.username, conn.owner.password);

// An outsider: a member of another project only, so the shared project is outside their scope.
const outsiderPassword = `Outsider-${stamp}-pass`;
const other = await owner.call('POST', '/api/engagements', {
  name: `export-${stamp}`, displayName: `Export outsider ${stamp}`, targetType: 'web_url', targetValue: `https://export-${stamp}.verification.invalid`,
  authorizationConfirmed: true, brief: 'Generated fixture for the export outsider. No target contact.',
});
await owner.call('POST', `/api/engagements/${other.json?.id}/members`, { username: `export-outsider-${stamp}`, displayName: 'Outsider', password: outsiderPassword, role: 'viewer' });
const outsider = await new ApiSession(conn.api, 'outsider').login(`export-outsider-${stamp}`, outsiderPassword);

let reportId = null;
let version = null;
try {
  await recorder.check('the operator creates a report and selects the confirmed finding', async () => {
    const created = await sessions.operator.call('POST', `/api/engagements/${project}/report-records`, { title, summary });
    reportId = created.json?.id ?? null;
    if (!reportId) return { ok: false, detail: `create HTTP ${created.status}` };
    const selected = await sessions.operator.call('PUT', `/api/engagements/${project}/report-records/${reportId}/findings`, { expectedVersion: created.json.version, findingIds: [conn.finding] });
    version = selected.json?.version ?? null;
    return { ok: selected.status < 300 && selected.json?.selectedFindings?.length === 1, detail: `create HTTP ${created.status}; select HTTP ${selected.status}; selected ${selected.json?.selectedFindings?.length ?? 0}` };
  });

  const exported = {};
  for (const format of ['markdown', 'json', 'pdf', 'docx']) {
    await recorder.check(`the ${format} export carries the title, the summary and the selected finding, and its digest matches the bytes`, async () => {
      const response = await sessions.viewer.call('GET', `/api/engagements/${project}/report-records/${reportId}/export?format=${format}`);
      const view = response.json ?? {};
      exported[format] = view;
      if (response.status !== 200) return { ok: false, detail: `viewer export HTTP ${response.status}` };
      const bytes = view.encoding === 'base64' ? Buffer.from(view.content, 'base64') : Buffer.from(view.content, 'utf8');
      const digest = createHash('sha256').update(bytes).digest('hex');
      const digestOk = digest === view.digest;
      let contentOk = false;
      let structureOnly = false;
      let note = '';
      if (format === 'markdown') {
        contentOk = view.content.includes(`# ${title}`) && view.content.includes(summary) && view.content.includes(`### ${FINDING_TITLE}`);
      } else if (format === 'json') {
        const parsed = JSON.parse(view.content);
        contentOk = parsed.title === title && parsed.body?.summary === summary && (parsed.findings ?? []).some((f) => f.title === FINDING_TITLE);
      } else if (format === 'pdf') {
        // The text streams are compressed, so only the file structure is read here; the report text is not checked.
        structureOnly = true;
        contentOk = bytes.subarray(0, 5).toString('latin1') === '%PDF-' && bytes.subarray(-64).toString('latin1').includes('%%EOF');
        note = 'file structure only: the PDF text streams are compressed';
      } else {
        // A DOCX is a zip: list it and read word/document.xml with the system tar, from a file in this run's scratch folder.
        const file = path.join(scratch, `export-${stamp}.docx`);
        writeFileSync(file, bytes);
        const listing = spawnSync(TAR, ['-tf', file], { encoding: 'utf8' });
        const xml = spawnSync(TAR, ['-xOf', file, 'word/document.xml'], { encoding: 'utf8' });
        rmSync(file, { force: true });
        contentOk = listing.status === 0 && /word\/document\.xml/.test(listing.stdout) && xml.stdout.includes(title) && xml.stdout.includes(summary) && xml.stdout.includes(FINDING_TITLE);
        note = 'read from word/document.xml';
      }
      return {
        status: digestOk && contentOk && structureOnly ? 'PARTIAL' : undefined,
        ok: digestOk && contentOk,
        detail: `HTTP ${response.status}; ${view.mediaType}; digest ${digestOk ? 'matches' : 'differs'}; content ${contentOk ? 'carries the report' : 'missing report text'}${note ? `; ${note}` : ''}`,
        evidence: { mediaType: view.mediaType, bytes: bytes.length },
      };
    });
  }

  await recorder.check('the markdown export names the finding version the stored report snapshots', async () => {
    const markdown = exported.markdown?.content ?? '';
    const stored = (await sessions.viewer.call('GET', `/api/engagements/${project}/report-records`)).json ?? [];
    const rows = Array.isArray(stored) ? stored : (stored.reports ?? []);
    const row = rows.find((candidate) => candidate.id === reportId);
    const snapshot = row?.selectedFindings?.[0];
    const named = snapshot ? markdown.includes(`finding v${snapshot.findingVersion}`) : false;
    return { ok: named, detail: snapshot ? `snapshot finding v${snapshot.findingVersion}; markdown names it: ${named}` : 'no stored snapshot found for the report' };
  });

  await recorder.check('an outsider gets 404 for the export and no report text', async () => {
    const response = await outsider.call('GET', `/api/engagements/${project}/report-records/${reportId}/export?format=markdown`);
    return { ok: response.status === 404 && !response.text.includes(summary), detail: `outsider export HTTP ${response.status}` };
  });

  await recorder.check('an unknown export format is refused and produces no file', async () => {
    const response = await sessions.viewer.call('GET', `/api/engagements/${project}/report-records/${reportId}/export?format=xlsx`);
    return { ok: response.status === 400, detail: `format=xlsx HTTP ${response.status}` };
  });

  recorder.note('snapshot-after-live-change', 'NV', 'the export reads stored snapshots; a live finding change is not exercised here (no finding edit path in this check)');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

const counts = recorder.save();
console.log(JSON.stringify(counts));
process.exitCode = (counts.FAIL ?? 0) > 0 ? 1 : 0;
