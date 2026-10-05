import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

// Standalone production config. Figma Make preview tooling lives in
// `.figma/` and is intentionally not part of this pipeline — production
// builds must not read `.figma/` configuration.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    base: '/',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      host: '127.0.0.1',
      port: Number(process.env.VITE_DEV_PORT || 5273),
      strictPort: false,
      proxy: {
        '/api': {
          target: env.RAPTIX_WEB_BACKEND_URL || 'http://127.0.0.1:5280',
          changeOrigin: true,
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
