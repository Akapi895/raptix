import neo4j, { type Driver } from "neo4j-driver";

export interface KgHost {
  /** IP when discovered by address, hostname when discovered by name only (e.g. a container) -- never both empty. */
  host: string;
  ip: string;
  services: { port: number; protocol: string; service: string; banner: string; status: string }[];
}

/**
 * Port for Raptix's real Neo4j AKG (knowledge/graph), read-only here --
 * apps/api has never had a Neo4j connection before this (see
 * assets.routes.ts's own comment: the Asset table and the AKG are
 * deliberately separate stores). Scoped to Host/Service nodes tagged with
 * a project's engagement name, the same scanner-observation shape every
 * other Raptix surface (findings, OPPLAN) already reads off disk --
 * this is the one piece that lives in Neo4j instead.
 */
export interface KnowledgeGraph {
  hostsForEngagement(engagement: string): Promise<KgHost[]>;
}

export class Neo4jKnowledgeGraph implements KnowledgeGraph {
  private readonly driver: Driver;

  public constructor(uri: string, user: string, password: string) {
    this.driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  }

  public async hostsForEngagement(engagement: string): Promise<KgHost[]> {
    const session = this.driver.session({ defaultAccessMode: neo4j.session.READ });
    try {
      const result = await session.run(
        `MATCH (h:Host) WHERE h.engagement = $engagement
          WITH h LIMIT 500
          OPTIONAL MATCH (h)-[r:HOSTS]-(s:Service)
          WHERE s.engagement = $engagement AND r.engagement = $engagement
         RETURN h.ip AS ip, h.hostname AS hostname,
                collect(CASE WHEN s IS NULL THEN NULL ELSE {port: s.port, protocol: s.protocol, service: s.service, banner: s.banner, status: s.status} END) AS services`,
        { engagement },
        { timeout: 4000 },
      );
      return result.records.flatMap((record) => {
        const ip = asString(record.get("ip"));
        const hostname = asString(record.get("hostname"));
        const host = ip || hostname;
        if (!host) return [];
        const services = (record.get("services") as unknown[])
          .filter((entry): entry is Record<string, unknown> => entry !== null && typeof entry === "object")
          .map((entry) => ({
            port: typeof entry.port === "number" ? entry.port : toNumber(entry.port),
            protocol: asString(entry.protocol),
            service: asString(entry.service),
            banner: asString(entry.banner),
            status: asString(entry.status),
          }))
          .filter((service) => service.port > 0);
        return [{ host, ip, services }];
      });
    } finally {
      await session.close();
    }
  }

  public async close(): Promise<void> {
    await this.driver.close();
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** neo4j-driver returns some integer properties as Neo4jInt ({low, high}) rather than a plain number. */
function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "toNumber" in value && typeof (value as { toNumber: unknown }).toNumber === "function") {
    return (value as { toNumber(): number }).toNumber();
  }
  return 0;
}

/** Used when NEO4J_URI/_USER/_PASSWORD are not configured -- the Asset Library sync degrades to a no-op, never a crash. */
export class UnconfiguredKnowledgeGraph implements KnowledgeGraph {
  public async hostsForEngagement(): Promise<KgHost[]> {
    return [];
  }
}
