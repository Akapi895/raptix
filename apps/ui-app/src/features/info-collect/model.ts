export type Provider = 'fofa' | 'zoomeye' | 'quake' | 'shodan';
export type ResultRow = Record<string, unknown>;
export interface SearchForm { provider: Provider; query: string; size: number; page: number; fields: string; full: boolean }
export interface SearchPayload { provider?: string; query: string; fields: string[]; results: ResultRow[]; total: number; page: number; size: number; expected_count?: number; shortfall?: number }
export interface ParseResult { query: string; explanation?: string; warnings?: string[] }
export interface ProviderConfig {
  label: string; placeholder: string; nlPlaceholder: string; hint: string; parseHint: string; maxSize: number; sizeHint: string;
  fullOption: { label: string; hint: string } | null; fields: string; presets: [string, string][]; fieldPresets: [string, string][];
  syntaxGuide: { summary: string; docsUrl: string; sections: [string, string[]][] };
}
// [[XXXX]] tokens below are compiled to \uXXXX escapes by tooling: those query values target
// Chinese-language page content (data contract, not UI text) and must stay non-ASCII at runtime.
export const PROVIDERS: Record<Provider, ProviderConfig> = {
  fofa: {
    label: 'FOFA', placeholder: 'e.g. app="Apache" && country="CN"', nlPlaceholder: 'e.g. find Apache sites in Missouri, US, with "Home" in the title', hint: 'Query syntax follows the FOFA docs and supports && / || / () etc.', parseHint: 'After parsing, a dialog shows the FOFA syntax (editable); confirm it, then fill it into the query box and run the search.', maxSize: 10000, sizeHint: 'The FOFA result cap depends on account privileges; the UI allows at most 10000.', fullOption: { label: 'Full mode', hint: 'Passes full=true to FOFA for more complete/fresh data; may consume more quota.' }, fields: 'host,ip,port,domain,title,protocol,country,region,city,server',
    presets: [['Apache + CN', 'app="Apache" && country="CN"'], ['Login page + CN', 'title="\u767b\u5f55" && country="CN"'], ['Domain', 'domain="example.com"'], ['IP', 'ip="1.1.1.1"']],
    fieldPresets: [['Minimal fields', 'host,ip,port,domain'], ['Web common', 'host,title,ip,port,domain,protocol,server,icp,country,region,city'], ['Enriched', 'host,ip,port,domain,title,protocol,country,region,city,server,asn,org,icp,header,banner']],
    syntaxGuide: { summary: 'FOFA matches exactly with field="value" and supports &&, ||, ! and parentheses; wrap strings in double quotes.', docsUrl: 'https://en.fofa.info/api', sections: [
      ['Common fields', ['app="Apache"', 'title="\u540e\u53f0\u7ba1\u7406"', 'body="Powered by"', 'domain="example.com"', 'host="https://example.com"', 'ip="1.1.1.1"', 'port="443"', 'country="CN"', 'city="Hangzhou"', 'server="nginx"']],
      ['Combinations', ['app="nginx" && country="CN"', 'title="login" || title="\u767b\u5f55"', '(app="Apache" || app="nginx") && port="443"', 'domain="example.com" && !title="404"']], ['Examples', ['cert="example.com" && port="443"', 'header="JSESSIONID" && country="CN"', 'icon_hash="-247388890"', 'fid="sZyXkR9e" && domain="example.com"']],
    ] },
  },
  zoomeye: {
    label: 'ZoomEye', placeholder: 'e.g. app="Apache" && country="CN"', nlPlaceholder: 'e.g. find SSH services in China, excluding honeypots', hint: 'ZoomEye supports app/title/domain/ip/port/country/city etc.', parseHint: 'After parsing, a dialog shows the ZoomEye syntax (editable); confirm it, then fill it into the query box and run the search.', maxSize: 10000, sizeHint: 'ZoomEye pagesize supports up to 10000; actual quota depends on your account.', fullOption: null, fields: 'ip,port,domain,hostname,title,service,app,country,city',
    presets: [['Apache + CN', 'app="Apache" && country="CN"'], ['SSH service', 'service="ssh"'], ['Domain', 'domain="example.com"'], ['IP', 'ip="1.1.1.1"']], fieldPresets: [['Minimal fields', 'ip,port,domain,hostname'], ['Web common', 'ip,port,domain,hostname,title,service,app,country,city'], ['Enriched', 'ip,port,domain,hostname,title,service,app,country,city,org,isp,ssl']],
    syntaxGuide: { summary: 'ZoomEye supports field search, quoted phrases, AND/OR/NOT and parentheses; field availability follows the official console.', docsUrl: 'https://www.zoomeye.ai/help', sections: [
      ['Common fields', ['app="Apache"', 'service="ssh"', 'title="\u767b\u5f55"', 'domain="example.com"', 'hostname="example.com"', 'ip="1.1.1.1"', 'port=443', 'country="CN"', 'city="Beijing"', 'org="Tencent"']], ['Combinations', ['app="nginx" AND country="CN"', 'service="http" AND (title="login" OR title="\u767b\u5f55")', 'domain="example.com" AND NOT app="cloudflare"', 'port=443 AND country="US"']], ['Examples', ['ssl.cert.fingerprint="SHA256\u503c"', 'iconhash="-247388890"', 'service="rdp" AND country="CN"', 'app="Elasticsearch" AND port=9200']],
    ] },
  },
  quake: {
    label: 'Quake', placeholder: 'e.g. service.name:"http" AND country_cn:"\u4e2d\u56fd"', nlPlaceholder: 'e.g. find HTTP services in China, title containing the login page', hint: 'Quake uses DSL syntax; common fields include service.name, domain, ip, port, country_cn.', parseHint: 'After parsing, a dialog shows the Quake DSL (editable); confirm it, then fill it into the query box and run the search.', maxSize: 10000, sizeHint: 'Quake size consumes credits; control the returned count as needed.', fullOption: { label: 'Latest data', hint: 'Passes latest=true to Quake to prefer the freshest data.' }, fields: 'ip,port,domain,service.name,service.http.title,location.country_cn,location.province_cn,location.city_cn',
    presets: [['HTTP + CN', 'service.name:"http" AND country_cn:"\u4e2d\u56fd"'], ['Port 443', 'port:443'], ['Domain', 'domain:"example.com"'], ['IP', 'ip:"1.1.1.1"']], fieldPresets: [['Minimal fields', 'ip,port,domain'], ['Web common', 'ip,port,domain,service.name,service.http.title,location.country_cn,location.city_cn'], ['Enriched', 'ip,port,domain,service.name,service.http.title,service.http.server,location.country_cn,location.province_cn,location.city_cn,asn']],
    syntaxGuide: { summary: 'Quake uses Lucene/DSL style queries, typically field:"value", with AND, OR and NOT as logic operators.', docsUrl: 'https://quake.360.net/quake/#/help', sections: [
      ['Common fields', ['service.name:"http"', 'service.http.title:"\u767b\u5f55"', 'service.http.server:"nginx"', 'domain:"example.com"', 'ip:"1.1.1.1"', 'port:443', 'country_cn:"\u4e2d\u56fd"', 'province_cn:"\u6d59\u6c5f"', 'city_cn:"\u676d\u5dde"']], ['Combinations', ['service.name:"http" AND country_cn:"\u4e2d\u56fd"', '(service.name:"http" OR service.name:"https") AND port:443', 'domain:"example.com" AND NOT service.http.title:"404"', 'service.http.title:"login" AND port:443']], ['Examples', ['service.http.favicon.hash:"-247388890"', 'service.http.response.header:"JSESSIONID"', 'service.name:"ssh" AND country_cn:"\u4e2d\u56fd"', 'service.http.title:"Dashboard" AND NOT ip:"127.0.0.1"']],
    ] },
  },
  shodan: {
    label: 'Shodan', placeholder: 'e.g. product:nginx country:CN', nlPlaceholder: 'e.g. find nginx assets in China on port 443', hint: 'Shodan uses filter:value syntax; common filters include product, port, country, org.', parseHint: 'After parsing, a dialog shows the Shodan filter syntax (editable); confirm it, then fill it into the query box and run the search.', maxSize: 1000, sizeHint: 'Shodan returns 100 per page; the backend aggregates pages automatically and caps a single request at 1000 to control quota.', fullOption: null, fields: 'ip_str,port,hostnames,domains,org,isp,location.country_name,location.city,product,transport',
    presets: [['Nginx + CN', 'product:nginx country:CN'], ['SSH service', 'port:22'], ['Cert domain', 'ssl.cert.subject.cn:example.com'], ['Amazon 443', 'org:"Amazon" port:443']], fieldPresets: [['Minimal fields', 'ip_str,port,hostnames,domains'], ['Web common', 'ip_str,port,hostnames,domains,product,org,location.country_name,location.city'], ['Enriched', 'ip_str,port,hostnames,domains,org,isp,asn,location.country_name,location.city,product,transport,ssl.cert.subject.cn']],
    syntaxGuide: { summary: 'Shodan searches banner data by default; use filter:value for exact conditions, double-quote values with spaces, and chain filters to narrow results.', docsUrl: 'https://help.shodan.io/the-basics/search-query-fundamentals', sections: [
      ['Common filters', ['product:nginx', 'port:443', 'country:CN', 'city:Shanghai', 'org:"Amazon"', 'asn:AS15169', 'hostname:example.com', 'ssl.cert.subject.cn:example.com', 'http.title:"Dashboard"']], ['Combinations', ['product:nginx country:CN', 'apache port:443 country:DE', 'org:"Amazon" port:443', 'ssl.cert.subject.cn:example.com port:443']], ['Examples', ['http.title:"login" country:CN', 'ssl:true port:443 hostname:example.com', 'vuln:CVE-2021-41773', 'has_screenshot:true product:nginx']],
    ] },
  },
};
export function provider(value: string): Provider { const code = value.trim().toLowerCase(); return code === 'zoomeye' || code === 'quake' || code === 'shodan' ? code : 'fofa'; }
export function inferTarget(row: ResultRow): string {
  const value = (key: string) => String(row[key] ?? '').trim();
  const host = value('host'); if (host) return host;
  const base = value('domain') || value('ip'), port = value('port'), protocol = value('protocol').toLowerCase(); if (!base) return '';
  if (!port) return base; const number = parseInt(port, 10);
  if (number === 80 || number === 443) return `${number === 443 ? 'https' : 'http'}://${base}:${number}`;
  return protocol === 'http' || protocol === 'https' ? `${protocol}://${base}:${port}` : `${base}:${port}`;
}
