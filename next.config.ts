import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
];

const nextConfig: NextConfig = {
  // Leave the database library to the Cloudflare adapter, which then picks its
  // Cloudflare build (encrypted connections the Workers way) instead of the Node one.
  serverExternalPackages: ['postgres'],
  // Which commit is live, shown on /api/health. Cloudflare's build service provides it.
  env: { LOCALITES_BUILD: (process.env.WORKERS_CI_COMMIT_SHA ?? 'local').slice(0, 7) },
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
