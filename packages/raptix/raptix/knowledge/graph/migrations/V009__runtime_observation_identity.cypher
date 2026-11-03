-- Backfill only scoped runtime data. Reference and Skillogy nodes are untouched.
MATCH (n) WHERE n.engagement IS NOT NULL AND n.engagement <> 'schema'
AND n.key IS NOT NULL AND n.observation_id IS NULL
SET n.observation_id = randomUUID();
