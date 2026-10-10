import { createContext } from 'react-router';
import type { Admin } from '@/server/auth/admin.server';
import type { Member } from '@/server/auth/member.server';
import type { Cloudflare } from '@/server/env';

/** Cloudflare's per-request settings, set by workers/app.ts and read by loaders. */
export const cloudflareContext = createContext<Cloudflare>();

/** The admin making this request, set only by the admin pages' gate (routes/admin/layout.tsx). */
export const adminContext = createContext<Admin>();

/** The signed-in person, set only by the member pages' gate (routes/member/layout.tsx). */
export const memberContext = createContext<Member>();
