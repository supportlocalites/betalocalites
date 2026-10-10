import type { Config } from '@react-router/dev/config';

/**
 * React Router (framework mode) on Cloudflare Workers (ADR-005). Pages are rendered on
 * the server; the Cloudflare Vite plugin builds the Worker and its static files.
 */
export default {
  appDirectory: 'src/app',
  ssr: true,
  // Send the whole (small) route list with the first page, so moving between pages
  // doesn't make extra trips to the Worker just to look routes up.
  routeDiscovery: { mode: 'initial' },
} satisfies Config;
