import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { apiDocsRoute } from './build/api-docs-route.ts';

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const mock = mode === 'demo' || (command === 'serve' && env.VITE_MOCK === '1');
  return {
    plugins: [apiDocsRoute()],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    define: { __MOCK_ENABLED__: JSON.stringify(mock) },
    build: {
      outDir: mode === 'demo' ? 'dist-demo' : 'dist',
      sourcemap: true,
      rolldownOptions: {
        input: { app: 'index.html', 'api-docs': 'api-docs.html' },
      },
    },
    server: {
      proxy: { '^/api(?:/|$)': { target: env.API_PROXY_TARGET || 'http://127.0.0.1:8080', changeOrigin: true } },
    },
  };
});
