import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// Canonical production config for the new console. Figma Make preview tooling
// was removed with the cutover (ticket 02, R01): production builds never read
// `.figma/` and need no site configuration.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    base: '/',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      host: '127.0.0.1',
      port: Number(process.env.VITE_DEV_PORT || 5273),
      strictPort: false,
      proxy: {
        '/api': {
          target: env.RAPTIX_WEB_BACKEND_URL || 'http://127.0.0.1:5280',
          // W03: preserve the browser's Host (incl. port). `changeOrigin: true`
          // rewrote Host to the backend port while Origin stayed on the UI
          // port, so the API's same-origin check refused every browser
          // login/mutation (403). The backend never vhosts on Host.
          changeOrigin: false,
        },
      },
    },
    preview: {
      host: '127.0.0.1',
      port: Number(process.env.VITE_PREVIEW_PORT || 5274),
      strictPort: false,
    },
    build: {
      sourcemap: false,
      outDir: 'dist',
    },
  }
})
