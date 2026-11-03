export interface ReconProviderConfig {
  fofa: { email: string; key: string } | null;
  zoomeye: { apiKey: string } | null;
  quake: { apiKey: string } | null;
  shodan: { apiKey: string } | null;
}

/** Each provider is independently optional -- an operator may only hold a key for one of the four. */
export function loadReconProviderConfig(env: NodeJS.ProcessEnv): ReconProviderConfig {
  const fofaEmail = env.FOFA_EMAIL?.trim();
  const fofaKey = env.FOFA_KEY?.trim();
  const zoomeyeKey = env.ZOOMEYE_API_KEY?.trim();
  const quakeKey = env.QUAKE_API_KEY?.trim();
  const shodanKey = env.SHODAN_API_KEY?.trim();
  return {
    fofa: fofaEmail && fofaKey ? { email: fofaEmail, key: fofaKey } : null,
    zoomeye: zoomeyeKey ? { apiKey: zoomeyeKey } : null,
    quake: quakeKey ? { apiKey: quakeKey } : null,
    shodan: shodanKey ? { apiKey: shodanKey } : null,
  };
}
