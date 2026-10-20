-- Rollback for migrations/20261031000100_asset_identity. Drops only the catalog table;
-- WebAsset and KG identity properties are untouched, so the runtime keeps writing.
DROP TABLE IF EXISTS "AssetIdentity";
