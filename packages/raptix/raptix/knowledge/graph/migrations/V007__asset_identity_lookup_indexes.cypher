-- KG schema v007 — asset identity lookups (ADR-0094).
--
-- The asset map reads one asset by its identity. Host and Entrypoint nodes carry asset_id, and
-- Endpoint nodes carry origin_asset_id. Each index is composite with the engagement, so a lookup is a
-- seek rather than a scan of every node in the database. Not unique: several KG nodes may represent
-- one canonical asset (a host seen by nmap and by a crawl, for example).
CREATE INDEX asset_host_identity IF NOT EXISTS
  FOR (n:Host) ON (n.engagement, n.asset_id);
CREATE INDEX asset_entrypoint_identity IF NOT EXISTS
  FOR (n:Entrypoint) ON (n.engagement, n.asset_id);
CREATE INDEX asset_endpoint_origin IF NOT EXISTS
  FOR (n:Endpoint) ON (n.engagement, n.origin_asset_id);
