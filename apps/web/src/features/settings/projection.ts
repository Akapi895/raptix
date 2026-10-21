/** Narrow template, detection and session-security summaries for organization panels. */
import type { Integration, Template, DetectState } from '../../domain/entities'
import type { ConsoleServices } from '../../domain/service-factory'
import type { RequestContext } from '../../domain/service'
import { projectAccessible } from '../../domain/policy'
import { projectView, scopedRows } from '../../domain/projection'
import { useServiceProjection } from '../../state/projection'

export function readSettingsTemplates(services: ConsoleServices, ctx: RequestContext): { templates: Template[] } {
  return projectView(services, ctx, 'settings-templates', (db) => ({ templates: db.templates }))
}

export interface DetectionSettingsRead { integrations: Integration[]; detection: Record<string, Record<string, DetectState>> }

export function readDetectionSettings(services: ConsoleServices, ctx: RequestContext): DetectionSettingsRead {
  return projectView(services, ctx, 'settings-detection', (db) => ({
    integrations: db.integrations.filter((i) => i.kind === 'SIEM'),
    detection: Object.fromEntries(Object.entries(db.detection).filter(([id]) => projectAccessible(db.projects.find((p) => p.id === id), ctx.actor))),
  }))
}

export function readSecurityActivity(services: ConsoleServices, ctx: RequestContext): number {
  return projectView(services, ctx, 'settings-security-activity', (db) => scopedRows(db, ctx, db.operations).filter((o) => ['running', 'paused'].includes(o.status)).length)
}

export function useSettingsTemplates(): { templates: Template[] } { return useServiceProjection(readSettingsTemplates) }
export function useDetectionSettings(): DetectionSettingsRead { return useServiceProjection(readDetectionSettings) }
export function useSecurityActivity(): number { return useServiceProjection(readSecurityActivity, 'all') }
