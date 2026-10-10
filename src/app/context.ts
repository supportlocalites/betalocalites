import { createContext } from 'react-router';
import type { Cloudflare } from '@/server/env';

/** Cloudflare's per-request settings, set by workers/app.ts and read by loaders. */
export const cloudflareContext = createContext<Cloudflare>();
