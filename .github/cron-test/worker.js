/* global console, Response -- runs on Cloudflare Workers */
// A throwaway Worker to test whether Cloudflare runs an every-5-minutes schedule on this
// account for a plain Worker (no Durable Object, no email). Deleted once the site watch runs.
export default {
  async scheduled() {
    console.log('cron test ran');
  },
  async fetch() {
    return new Response('Not found', { status: 404 });
  },
};
