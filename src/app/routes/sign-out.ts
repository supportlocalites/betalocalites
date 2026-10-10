import { redirect } from 'react-router';
import { cloudflareContext } from '@/app/context';
import { signOut } from '@/server/auth/gotrue.server';
import { clearedCookies, loadSession, withCookies } from '@/server/auth/session.server';
import type { Route } from './+types/sign-out';

/** Ends the session with Supabase (so the old cookies stop working) and clears them. */
export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const { session } = await loadSession(request, env).catch(() => ({ session: null }));
  if (session) await signOut(env, session.accessToken).catch(() => undefined);
  return redirect('/', withCookies(undefined, clearedCookies()));
}

export function loader() {
  return redirect('/');
}
