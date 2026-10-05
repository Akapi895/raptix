-- Surface inventory contract for Initial Foothold recon.
CREATE CONSTRAINT endpoint_key_engagement IF NOT EXISTS
  FOR (n:Endpoint) REQUIRE (n.key, n.engagement) IS UNIQUE;
CREATE CONSTRAINT parameter_key_engagement IF NOT EXISTS
  FOR (n:Parameter) REQUIRE (n.key, n.engagement) IS UNIQUE;
CREATE CONSTRAINT form_key_engagement IF NOT EXISTS
  FOR (n:Form) REQUIRE (n.key, n.engagement) IS UNIQUE;
CREATE CONSTRAINT auth_model_key_engagement IF NOT EXISTS
  FOR (n:AuthModel) REQUIRE (n.key, n.engagement) IS UNIQUE;
