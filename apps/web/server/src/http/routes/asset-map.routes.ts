import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ASSET_MAP_KINDS, type AssetMapKind } from '@raptix/web-contracts';
import type { LocalIdentity } from '../../auth/identity-provider.js';
import {
  ASSET_MAP_LIMITS,
  AssetMapInputError,
  AssetMapNotFoundError,
  AssetMapRevisionError,
  type AssetMapService,
} from '../../services/asset-map-service.js';
import { GraphUnavailableError } from '../../services/graph-service.js';
import { runProjectsHandler } from './projects.routes.js';

function clampLimit(raw: string | undefined, fallback: number, max: number): number {
  const parsed = Number(raw ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) throw new AssetMapInputError('limit must be a positive integer');
  return Math.min(parsed, max);
}

/**
 * Plan phase 3 asset-map read models. Failures keep their meaning: bad input is 400,
 * an asset outside the engagement is 404, a cursor from an older revision is 409 so
 * the client restarts paging, and an unavailable graph is 503 rather than an empty map.
 */
export function registerAssetMapRoutes(app: FastifyInstance, assets: AssetMapService, identity: LocalIdentity): void {
  const prefix = '/api/engagements/:id/asset-map';
  const handler = (operation: (request: FastifyRequest, engagementId: string) => Promise<unknown>) => (request: FastifyRequest, reply: FastifyReply) =>
    runProjectsHandler(request, reply, async () => {
      reply.header('Cache-Control', 'no-store');
      try {
        return await operation(request, (request.params as { id: string }).id);
      } catch (error) {
        if (error instanceof AssetMapInputError) {
          reply.code(400);
          return { error: error.message };
        }
        if (error instanceof AssetMapNotFoundError) {
          reply.code(404);
          return { error: error.message };
        }
        if (error instanceof AssetMapRevisionError) {
          reply.code(409);
          return { error: 'revision_changed', message: error.message };
        }
        if (error instanceof GraphUnavailableError) {
          reply.code(503);
          return { error: 'Knowledge graph unavailable' };
        }
        throw error;
      }
    });

  app.get(`${prefix}/overview`, handler((_request, id) => assets.overview(identity.id, id)));

  app.get(`${prefix}/groups/:kind/members`, handler((request, id) => {
    const { kind } = request.params as { kind: string };
    if (!(ASSET_MAP_KINDS as readonly string[]).includes(kind)) throw new AssetMapInputError('unknown asset kind');
    const query = request.query as { cursor?: string; limit?: string };
    return assets.members(
      identity.id,
      id,
      kind as AssetMapKind,
      query.cursor ?? null,
      clampLimit(query.limit, ASSET_MAP_LIMITS.membersDefault, ASSET_MAP_LIMITS.membersMax),
    );
  }));

  app.get(`${prefix}/search`, handler((request, id) => {
    const query = request.query as { q?: string; limit?: string };
    return assets.search(identity.id, id, query.q ?? '', clampLimit(query.limit, ASSET_MAP_LIMITS.searchDefault, ASSET_MAP_LIMITS.searchMax));
  }));

  app.get(`${prefix}/assets/:assetId/neighborhood`, handler((request, id) => {
    const { assetId } = request.params as { assetId: string };
    const query = request.query as { cursor?: string };
    return assets.neighborhood(identity.id, id, assetId, query.cursor ?? null);
  }));

  app.get(`${prefix}/assets/:assetId/detail`, handler((request, id) => {
    const { assetId } = request.params as { assetId: string };
    const query = request.query as { cursor?: string; limit?: string };
    return assets.detail(
      identity.id,
      id,
      assetId,
      query.cursor ?? null,
      clampLimit(query.limit, ASSET_MAP_LIMITS.detailDefault, ASSET_MAP_LIMITS.detailMax),
    );
  }));
}
