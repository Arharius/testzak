import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Optional override for subpath hosting (for example /react/ on PythonAnywhere).
const explicitBase = process.env.VITE_BASE_PATH;

// Hosted builds use root base by default. Only explicit GH_PAGES=1 keeps /testzak/.
const isGhPages = !!process.env.GH_PAGES;
const base = explicitBase || (isGhPages ? '/testzak/' : '/');

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const deprecatedBackendTargets = new Set([
    'https://backend-production-3b942.up.railway.app',
  ]);
  const normalizeBackendTarget = (value: string) => {
    const normalized = String(value || '').trim().replace(/\/$/, '');
    if (!normalized) return 'https://backend-production-f736.up.railway.app';
    if (deprecatedBackendTargets.has(normalized)) {
      return 'https://backend-production-f736.up.railway.app';
    }
    return normalized;
  };
  const backendTarget = normalizeBackendTarget(env.VITE_BACKEND_URL || 'https://backend-production-f736.up.railway.app');
  const devHost = env.VITE_DEV_HOST || '127.0.0.1';
  const apiProxy = {
    '/api': {
      target: backendTarget,
      changeOrigin: true,
      secure: true,
    },
    '/proxy/zakupki': {
      target: 'https://zakupki.gov.ru',
      changeOrigin: true,
      rewrite: (path: string) => path.replace(/^\/proxy\/zakupki/, ''),
      secure: true,
    },
  };

  return {
    base,
    plugins: [react()],
    build: {
      // After lazy-loading preview/panels and keeping PDF/DOCX exporters out of the initial path,
      // the remaining large chunks are intentional app-shell/export chunks rather than accidental eager deps.
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return;
            if (id.includes('/docx')) {
              return 'docx-vendor';
            }
            if (id.includes('/jspdf') || id.includes('/html2canvas') || id.includes('/canvg')) {
              return 'pdf-vendor';
            }
            if (id.includes('/file-saver')) {
              return 'export-vendor';
            }
            if (id.includes('/@tanstack/')) {
              return 'query-vendor';
            }
            if (id.includes('/react-hook-form/') || id.includes('/@hookform/')) {
              return 'form-vendor';
            }
            if (id.includes('/zod/')) {
              return 'schema-vendor';
            }
            if (id.includes('/axios/') || id.includes('/clsx/')) {
              return 'runtime-vendor';
            }
            return 'vendor';
          },
        },
      },
    },
    server: {
      host: '0.0.0.0',
      port: 5000,
      strictPort: true,
      allowedHosts: true,
      proxy: apiProxy,
    },
    preview: {
      host: '0.0.0.0',
      port: 5000,
      strictPort: true,
      allowedHosts: true,
      proxy: apiProxy,
    },
  };
});
