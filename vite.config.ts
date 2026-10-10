import { cloudflare } from '@cloudflare/vite-plugin';
import { reactRouter } from '@react-router/dev/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [cloudflare({ viteEnvironment: { name: 'ssr' } }), reactRouter()],
  resolve: { tsconfigPaths: true },
  define: {
    // Which commit is live, shown on /api/health. Cloudflare's build service provides it.
    'import.meta.env.LOCALITES_BUILD': JSON.stringify((process.env.WORKERS_CI_COMMIT_SHA ?? 'local').slice(0, 7)),
  },
});
