import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// NETLIFY_BUILD=1 or NETLIFY=true → base '/', otherwise '/testzak/' (GH Pages)
const isNetlify = !!(process.env.NETLIFY || process.env.NETLIFY_BUILD);
const base = isNetlify ? '/' : '/testzak/';

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5174,
    proxy: {
      '/api': {
        target: 'https://tz-generator-backend.onrender.com',
        changeOrigin: true,
        secure: true,
      },
      '/proxy/zakupki': {
        target: 'https://zakupki.gov.ru',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy\/zakupki/, ''),
        secure: true,
      },
    },
  },
});
