/**
 * Which typed view an asset kind gets in the inspector (plan phase 7). The server decides the detail
 * payload; this table only names the view the page shows for it, so a kind without a typed view says so
 * instead of falling back to a host-shaped list. Domains without retained data are not listed here.
 */
export type DomainRenderer = 'services' | 'sitemap' | 'typed-fallback';

const RENDERERS: Readonly<Record<string, DomainRenderer>> = {
  host: 'services',
  dns_name: 'services',
  web_origin: 'sitemap',
};

export function rendererFor(kind: string): DomainRenderer {
  return RENDERERS[kind] ?? 'typed-fallback';
}

/** The label the inspector shows for a renderer, so the view named on screen is the one in use. */
export function rendererLabel(renderer: DomainRenderer): string {
  if (renderer === 'services') return 'Typed view: services';
  if (renderer === 'sitemap') return 'Typed view: sitemap';
  return 'No typed view yet';
}
