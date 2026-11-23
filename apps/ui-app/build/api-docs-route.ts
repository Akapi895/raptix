import type { Plugin, Connect } from 'vite';

/** Keep the public Go route usable when Vite serves the two static entries. */
export function apiDocsRoute(): Plugin {
  const rewrite: Connect.NextHandleFunction = (request, _response, next) => {
    if (request.url?.split('?')[0] === '/api-docs') {
      request.url = request.url.replace('/api-docs', '/api-docs.html');
    }
    next();
  };
  return {
    name: 'api-docs-route',
    configureServer(server) { server.middlewares.use(rewrite); },
    configurePreviewServer(server) { server.middlewares.use(rewrite); },
  };
}
