import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Optional override for subpath hosting (for example /react/ on PythonAnywhere).
const explicitBase = process.env.VITE_BASE_PATH;

// Hosted builds use root base by default. Only explicit GH_PAGES=1 keeps /testzak/.
const isGhPages = !!process.env.GH_PAGES;
const base = explicitBase || (isGhPages ? '/testzak/' : '/');

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendTarget = (env.VITE_BACKEND_URL || 'https://backend-production-3b942.up.railway.app').replace(/\/$/, '');
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
      chunkSizeWarningLimit: 700,
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
      host: devHost,
      port: 5174,
      strictPort: true,
      proxy: apiProxy,
    },
    preview: {
      host: devHost,
      strictPort: true,
      proxy: apiProxy,
    },
  };
});
