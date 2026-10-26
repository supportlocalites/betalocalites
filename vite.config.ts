import { cloudflare } from '@cloudflare/vite-plugin';
import { reactRouter } from '@react-router/dev/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // Tests and local runs never reach Cloudflare's own services (the AI checker has a pretend one):
  // CLOUDFLARE_VITE_FORCE_LOCAL=true in .env. Said here too, since newer versions of the plugin
  // no longer read that setting themselves.
  const local = loadEnv(mode, process.cwd(), 'CLOUDFLARE_VITE_').CLOUDFLARE_VITE_FORCE_LOCAL === 'true';
  return {
    plugins: [cloudflare({ viteEnvironment: { name: 'ssr' }, remoteBindings: !local }), reactRouter()],
    resolve: { tsconfigPaths: true },
    // Smaller server code starts faster on Cloudflare.
    environments: { ssr: { build: { minify: true } } },
    define: {
      // Which commit is live, shown on /api/health. Cloudflare's build service provides it.
      'import.meta.env.LOCALITES_BUILD': JSON.stringify((process.env.WORKERS_CI_COMMIT_SHA ?? 'local').slice(0, 7)),
    },
  };
});
