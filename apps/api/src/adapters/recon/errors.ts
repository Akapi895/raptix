/** No credential configured for the requested recon provider. */
export class ReconProviderUnconfiguredError extends Error {
  public constructor(provider: string) {
    super(`no credentials configured for recon provider ${provider}`);
    this.name = "ReconProviderUnconfiguredError";
  }
}

/** The provider's own API rejected the request or returned an error payload. */
export class ReconProviderRejectedError extends Error {
  public constructor(provider: string, detail: string) {
    super(`${provider} rejected the search: ${detail}`);
    this.name = "ReconProviderRejectedError";
  }
}
