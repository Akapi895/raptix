-- Keep write-version markers outside engagement graph projections.
CREATE CONSTRAINT kg_revision_scope IF NOT EXISTS FOR (v:KGRevision) REQUIRE v.scope IS UNIQUE;
