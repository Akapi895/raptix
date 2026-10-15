import { readFile, readdir, stat, realpath } from 'node:fs/promises';
import * as path from 'node:path';
import type { FindingsView, FindingView } from '@raptix/web-contracts';
import type { PrismaClient } from '../generated/prisma/client.js';
import { resolveEngagementWorkspaceDir } from '../security/workspace-policy.js';
import { ProjectNotFoundError } from './projects-service.js';
import { requireEngagementAccess } from '../auth/membership-policy.js';

/**
 * W12 findings projection: parse `FIND-*.md` files from the engagement
 * workspace's `findings/` directory (legacy parser semantics preserved) and
 * project them as public views with explicit parser-quality flags. Defaults
 * (medium severity, placeholder description/evidence) are flagged, never
 * presented as analyst-confirmed. Malformed findings stay viewable through
 * their bounded raw source; nothing is fabricated.
 */

const MAX_FILES = 100;
const MAX_FILE_BYTES = 256 * 1024;
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'informational'] as const;
type Severity = (typeof SEVERITIES)[number];

const isSeverity = (value: string): value is Severity => (SEVERITIES as readonly string[]).includes(value);

export class FindingsService {
  public constructor(private readonly db: PrismaClient, private readonly workspaceRoot: string) {}

  private async workspaceDir(userId: string, engagementId: string): Promise<string> {
    const project = await this.db.engagement.findFirst({ where: { id: engagementId } });
    if (!project) throw new ProjectNotFoundError();
    if (project.userId !== userId) await requireEngagementAccess({ db: this.db, actorId: userId, multiUser: true }, engagementId, 'viewer');
    return resolveEngagementWorkspaceDir(this.workspaceRoot, project.workspaceSlug);
  }

  public async list(userId: string, engagementId: string): Promise<FindingsView> {
    const dir = await this.workspaceDir(userId, engagementId);
    const findingsDir = path.join(dir, 'findings');
    const findings: FindingView[] = [];
    let truncated = false;
    let names: string[] = [];
    const realDir = await realpath(dir).catch(() => null);
    if (realDir === null) return { engagementId, findings, truncated: false, source: 'workspace' };
    try {
      names = (await readdir(findingsDir)).filter(name => name.startsWith('FIND-') && name.endsWith('.md')).sort();
    } catch { return { engagementId, findings, truncated: false, source: 'workspace' }; }
    if (names.length > MAX_FILES) { names = names.slice(0, MAX_FILES); truncated = true; }
    for (const name of names) {
      const file = path.join(findingsDir, name);
      try {
        const realFile = await realpath(file);
        if (!realFile.startsWith(realDir + path.sep)) { truncated = true; continue; }
        const info = await stat(file);
        if (!info.isFile() || info.size > MAX_FILE_BYTES) { truncated = true; continue; }
        const content = await readFile(file, 'utf8');
        findings.push(parseFindingMarkdown(content, name, engagementId, info.size));
      } catch { truncated = true; }
    }
    return { engagementId, findings, truncated, source: 'workspace' };
  }
}

export function parseFindingMarkdown(content: string, filename: string, engagementId: string, sizeBytes: number): FindingView {
  let title = filename.replace(/\.md$/, '');
  let severity: Severity = 'medium';
  let defaultSeverity = true;
  let description = '';
  let evidence = '';
  let attackVector = '';
  let remediation = '';
  const affectedAssets: string[] = [];
  const cwe = new Set<string>();
  const mitre = new Set<string>();
  let cvssScore: number | undefined;
  let cvssVector: string | undefined;
  let currentSection = '';

  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('# ') && line.length > 2) { title = line.slice(2).trim(); continue; }
    if (line.startsWith('## ')) { currentSection = line.slice(3).trim().toLowerCase(); continue; }
    const lowered = line.toLowerCase();
    if (lowered.includes('severity') && line.includes(':')) {
      const value = line.split(':')[1]?.trim().replace(/\*/g, '').toLowerCase() ?? '';
      if (isSeverity(value)) { severity = value; defaultSeverity = false; }
    }
    if (lowered.startsWith('cvss score') && line.includes(':')) {
      const value = Number.parseFloat(line.split(':')[1]?.trim() ?? '');
      if (Number.isFinite(value) && value >= 0 && value <= 10) cvssScore = value;
    }
    if (lowered.startsWith('cvss vector') && line.includes(':')) {
      cvssVector = line.split(':').slice(1).join(':').trim() || undefined;
    }
    if (line.startsWith('-') || line.startsWith('*')) {
      const item = line.replace(/^[-*]\s*/, '');
      if (currentSection === 'affected' || currentSection === 'affected assets' || currentSection === 'assets') {
        if (item && item.length <= 300) affectedAssets.push(item);
        continue;
      }
    }
    if (currentSection === 'description' && line) description += (description ? '\n' : '') + line;
    if (currentSection === 'evidence' && line) evidence += (evidence ? '\n' : '') + line;
    if ((currentSection === 'attack vector' || currentSection === 'attack-vector') && line) attackVector += (attackVector ? '\n' : '') + line;
    if (currentSection === 'remediation' && line) remediation += (remediation ? '\n' : '') + line;
    if (currentSection === 'cwe' || currentSection === 'weaknesses') {
      for (const match of line.match(/CWE-\d+/g) ?? []) cwe.add(match);
    }
    if (currentSection === 'mitre' || currentSection === 'mitre att&ck' || currentSection === 'techniques') {
      for (const match of line.match(/T\d{4}(\.\d+)?/g) ?? []) mitre.add(match);
    }
  }

  return {
    engagementId,
    id: filename.replace(/\.md$/, ''),
    title: title.slice(0, 300),
    severity,
    description: description.slice(0, 8000) || 'No description available.',
    evidence: evidence.slice(0, 8000) || 'No evidence recorded.',
    attackVector: attackVector.slice(0, 2000) || 'Unknown',
    affectedAssets: affectedAssets.slice(0, 50),
    ...(cvssScore !== undefined ? { cvssScore } : {}),
    ...(cvssVector !== undefined ? { cvssVector } : {}),
    ...(cwe.size ? { cwe: [...cwe].slice(0, 20) } : {}),
    ...(mitre.size ? { mitre: [...mitre].slice(0, 20) } : {}),
    ...(remediation ? { remediation: remediation.slice(0, 8000) } : {}),
    quality: { defaultSeverity, placeholderDescription: description.length === 0, placeholderEvidence: evidence.length === 0, unreadable: false },
    rawSource: content.slice(0, 65536),
    sizeBytes,
    source: 'workspace',
  };
}
