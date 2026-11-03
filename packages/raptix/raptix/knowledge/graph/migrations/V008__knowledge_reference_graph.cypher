-- The base label enforces namespaced identity across reference subtypes.
CREATE CONSTRAINT krg_reference_id IF NOT EXISTS FOR (n:KrgReference) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT krg_technique_id IF NOT EXISTS FOR (n:KrgAttackTechnique) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT krg_tactic_id IF NOT EXISTS FOR (n:KrgAttackTactic) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT krg_mitigation_id IF NOT EXISTS FOR (n:KrgMitigation) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT krg_group_id IF NOT EXISTS FOR (n:KrgAttackGroup) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT krg_software_id IF NOT EXISTS FOR (n:KrgAttackSoftware) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT krg_campaign_id IF NOT EXISTS FOR (n:KrgAttackCampaign) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT krg_cwe_id IF NOT EXISTS FOR (n:KrgCwe) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT krg_capec_id IF NOT EXISTS FOR (n:KrgCapec) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT krg_cisakev_id IF NOT EXISTS FOR (n:KrgCisaKev) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT krg_owasp_id IF NOT EXISTS FOR (n:KrgOwaspControl) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT krg_atlas_case_id IF NOT EXISTS FOR (n:KrgAtlasCase) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT krg_atlas_technique_id IF NOT EXISTS FOR (n:KrgAtlasTechnique) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT krg_atlas_tactic_id IF NOT EXISTS FOR (n:KrgAtlasTactic) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT krg_unresolved_ref IF NOT EXISTS FOR (n:KrgUnresolvedRef) REQUIRE (n.namespace, n.id) IS UNIQUE;
CREATE INDEX krg_reference_source IF NOT EXISTS FOR (n:KrgReference) ON (n.source);
