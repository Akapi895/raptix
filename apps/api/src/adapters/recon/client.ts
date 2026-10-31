import type { ReconProviderConfig } from "./config.js";
import { ReconProviderRejectedError, ReconProviderUnconfiguredError } from "./errors.js";

export type ReconProvider = "fofa" | "zoomeye" | "quake" | "shodan";

export interface ReconSearchArgs {
  provider: ReconProvider;
  query: string;
  size: number;
  page: number;
  fields: string;
  full: boolean;
}

export interface ReconSearchResult {
  provider: string;
  query: string;
  fields: string[];
  results: Record<string, unknown>[];
  total: number;
  page: number;
  size: number;
}

export interface ReconProvidersTransport {
  search(args: ReconSearchArgs): Promise<ReconSearchResult>;
}

/**
 * Thin passthrough to the four public attack-surface search engines
 * apps/ui-app's "info-collect" page targets (internal/handler/fofa.go's
 * multi-provider dispatch). Each call uses only the operator's own
 * configured credentials for that one provider -- read-only queries
 * against already-public internet-wide scan databases, the same thing a
 * Shodan/FOFA web search does.
 */
export class ReconProvidersClient implements ReconProvidersTransport {
  public constructor(
    private readonly config: ReconProviderConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  public async search(args: ReconSearchArgs): Promise<ReconSearchResult> {
    switch (args.provider) {
      case "fofa":
        return this.searchFofa(args);
      case "zoomeye":
        return this.searchZoomeye(args);
      case "quake":
        return this.searchQuake(args);
      case "shodan":
        return this.searchShodan(args);
    }
  }

  private async searchFofa(args: ReconSearchArgs): Promise<ReconSearchResult> {
    const creds = this.config.fofa;
    if (!creds) throw new ReconProviderUnconfiguredError("fofa");
    const fields = args.fields || "host,ip,port,domain,title,protocol,country,region,city,server";
    const qbase64 = Buffer.from(args.query, "utf8").toString("base64");
    const url = new URL("https://fofa.info/api/v1/search/all");
    url.searchParams.set("email", creds.email);
    url.searchParams.set("key", creds.key);
    url.searchParams.set("qbase64", qbase64);
    url.searchParams.set("size", String(args.size));
    url.searchParams.set("page", String(args.page));
    url.searchParams.set("fields", fields);
    if (args.full) url.searchParams.set("full", "true");
    const response = await this.fetchImpl(url);
    const body = (await response.json().catch(() => ({}))) as {
      error?: boolean;
      errmsg?: string;
      size?: number;
      results?: unknown[];
    };
    if (body.error) throw new ReconProviderRejectedError("fofa", body.errmsg ?? `HTTP ${response.status}`);
    const fieldList = fields.split(",").map((field) => field.trim());
    const results = (body.results ?? []).map((row) =>
      Array.isArray(row) ? Object.fromEntries(fieldList.map((field, index) => [field, row[index] ?? ""])) : (row as Record<string, unknown>),
    );
    return { provider: "fofa", query: args.query, fields: fieldList, results, total: body.size ?? results.length, page: args.page, size: args.size };
  }

  private async searchZoomeye(args: ReconSearchArgs): Promise<ReconSearchResult> {
    const creds = this.config.zoomeye;
    if (!creds) throw new ReconProviderUnconfiguredError("zoomeye");
    const fields = args.fields || "ip,port,domain,hostname,title,service,app,country,city";
    const url = new URL("https://api.zoomeye.org/host/search");
    url.searchParams.set("query", args.query);
    url.searchParams.set("page", String(args.page));
    const response = await this.fetchImpl(url, { headers: { "API-KEY": creds.apiKey } });
    const body = (await response.json().catch(() => ({}))) as { error?: string; matches?: Record<string, unknown>[]; total?: number };
    if (!response.ok) throw new ReconProviderRejectedError("zoomeye", body.error ?? `HTTP ${response.status}`);
    const results = (body.matches ?? []).slice(0, args.size);
    return { provider: "zoomeye", query: args.query, fields: fields.split(",").map((field) => field.trim()), results, total: body.total ?? results.length, page: args.page, size: args.size };
  }

  private async searchQuake(args: ReconSearchArgs): Promise<ReconSearchResult> {
    const creds = this.config.quake;
    if (!creds) throw new ReconProviderUnconfiguredError("quake");
    const fields = args.fields || "ip,port,domain,service.name,service.http.title,location.country_cn,location.province_cn,location.city_cn";
    const response = await this.fetchImpl("https://quake.360.net/api/v3/search/quake_service", {
      method: "POST",
      headers: { "X-QuakeToken": creds.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ query: args.query, start: (args.page - 1) * args.size, size: args.size, latest: args.full }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      code?: number;
      message?: string;
      data?: Record<string, unknown>[];
      meta?: { pagination?: { total?: number } };
    };
    if (body.code !== 0) throw new ReconProviderRejectedError("quake", body.message ?? `HTTP ${response.status}`);
    const results = body.data ?? [];
    return { provider: "quake", query: args.query, fields: fields.split(",").map((field) => field.trim()), results, total: body.meta?.pagination?.total ?? results.length, page: args.page, size: args.size };
  }

  private async searchShodan(args: ReconSearchArgs): Promise<ReconSearchResult> {
    const creds = this.config.shodan;
    if (!creds) throw new ReconProviderUnconfiguredError("shodan");
    const fields = args.fields || "ip_str,port,hostnames,domains,org,isp,location.country_name,location.city,product,transport";
    const url = new URL("https://api.shodan.io/shodan/host/search");
    url.searchParams.set("key", creds.apiKey);
    url.searchParams.set("query", args.query);
    url.searchParams.set("page", String(args.page));
    const response = await this.fetchImpl(url);
    const body = (await response.json().catch(() => ({}))) as { error?: string; matches?: Record<string, unknown>[]; total?: number };
    if (!response.ok) throw new ReconProviderRejectedError("shodan", body.error ?? `HTTP ${response.status}`);
    const results = (body.matches ?? []).slice(0, Math.min(args.size, 1000));
    return { provider: "shodan", query: args.query, fields: fields.split(",").map((field) => field.trim()), results, total: body.total ?? results.length, page: args.page, size: args.size };
  }
}
