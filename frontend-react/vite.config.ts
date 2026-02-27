import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Hosted builds (Netlify/Vercel) use root base. Local GH Pages flow keeps /testzak/.
const isHostedBuild = !!(
  process.env.NETLIFY ||
  process.env.NETLIFY_BUILD ||
  process.env.VERCEL ||
  process.env.VERCEL_ENV
);
const base = isHostedBuild ? '/' : '/testzak/';

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
