import type { ReconProvidersTransport, ReconSearchArgs, ReconSearchResult } from "../../src/adapters/recon/client.js";

export class FakeRecon implements ReconProvidersTransport {
  public calls: ReconSearchArgs[] = [];
  public responses = new Map<string, ReconSearchResult>();
  public rejections = new Map<string, Error>();

  public async search(args: ReconSearchArgs): Promise<ReconSearchResult> {
    this.calls.push(args);
    const rejection = this.rejections.get(args.provider);
    if (rejection) throw rejection;
    return this.responses.get(args.provider) ?? { provider: args.provider, query: args.query, fields: [], results: [], total: 0, page: args.page, size: args.size };
  }
}
