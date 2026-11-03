import type { FastifyInstance } from "fastify";
import type { RuntimeTransport } from "../../adapters/runtime/client.js";
import { RuntimeUnavailableError } from "../../adapters/runtime/errors.js";
import type { AuthStore } from "../../db/auth-store.js";
import { createRequireSession } from "../plugins/auth-guard.js";

export interface SpecialistsRoutesOptions {
  authStore: AuthStore;
  runtime: RuntimeTransport;
}

// The orchestrator itself is registered as a graph (so it can run), but it is
// not a specialist a user dispatches to -- exclude it and its aliases.
const ORCHESTRATOR_GRAPH_IDS = new Set(["raptix", "raptix-delta", "decepticon"]);

/**
 * Display name/description lifted from each standard graph's own module
 * docstring (packages/raptix/raptix/intelligence/agents/standard/<id>.py).
 * `graphIds` from the runtime is the authoritative list of what's actually
 * registered (including plugin-backed domain specialists only when their
 * bundle is enabled, see raptix_core.plugin_loader) -- this catalog only
 * supplies human-friendly text for ids that are already live.
 */
const CATALOG: Readonly<Record<string, { name: string; description: string }>> = {
  recon: { name: "Recon", description: "Autonomous reconnaissance and intelligence gathering." },
  autohunt: { name: "Autohunt", description: "Autonomous single-target engagement bootstrap." },
  soundwave: { name: "Soundwave", description: "Engagement document writer." },
  exploit: { name: "Exploit", description: "Initial access and vulnerability exploitation." },
  surface_exploit: { name: "Surface Exploit", description: "Parameterized web/API surface-exploit specialist." },
  postexploit: { name: "PostExploit", description: "Post-exploitation operations." },
  analyst: { name: "Analyst", description: "Vulnerability research specialist." },
  reverser: { name: "Reverser", description: "Reverse engineering (reversing domain plugin)." },
  contract_auditor: { name: "Contract Auditor", description: "Smart contract auditing (contracts domain plugin)." },
  cloud_hunter: { name: "Cloud Hunter", description: "Cloud attack surface hunting (cloud domain plugin)." },
  ad_operator: { name: "AD Operator", description: "Active Directory operations (active-directory domain plugin)." },
  blue_cell: { name: "Blue Cell", description: "Defensive sibling that closes the Offensive Vaccine loop." },
  phisher: { name: "Phisher", description: "Phishing operations (phishing domain plugin)." },
  mobile_operator: { name: "Mobile Operator", description: "Mobile attack surface (mobile domain plugin)." },
  wireless_operator: { name: "Wireless Operator", description: "Wireless attack surface (wireless domain plugin)." },
  osint_operator: { name: "OSINT Operator", description: "Passive OSINT / recon-intelligence lane." },
  iot_operator: { name: "IoT Operator", description: "IoT attack surface (iot domain plugin)." },
  ics_operator: { name: "ICS Operator", description: "ICS/OT attack surface (ics domain plugin)." },
  forensicator: { name: "Forensicator", description: "DFIR / forensics + purple-team validation lane." },
  supply_chain_operator: { name: "Supply Chain Operator", description: "Software supply-chain attack lane." },
};

function toDisplayName(id: string): string {
  return id.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

export function registerSpecialistsRoutes(app: FastifyInstance, options: SpecialistsRoutesOptions): void {
  const requireSession = createRequireSession(options.authStore);

  app.get("/api/specialists", { preHandler: requireSession }, async (_request, reply) => {
    try {
      const { graphIds } = await options.runtime.ping();
      const specialists = graphIds
        .filter((id) => !ORCHESTRATOR_GRAPH_IDS.has(id))
        .map((id) => ({ id, name: CATALOG[id]?.name ?? toDisplayName(id), description: CATALOG[id]?.description ?? "" }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { specialists };
    } catch (error) {
      if (error instanceof RuntimeUnavailableError) {
        await reply.code(503).send({ error: error.message });
        return;
      }
      throw error;
    }
  });
}
