import { createContext } from 'react-router';
import type { Admin } from '@/server/auth/admin.server';
import type { Cloudflare } from '@/server/env';

/** Cloudflare's per-request settings, set by workers/app.ts and read by loaders. */
export const cloudflareContext = createContext<Cloudflare>();

/** The admin making this request, set only by the admin pages' gate (routes/admin/layout.tsx). */
export const adminContext = createContext<Admin>();
