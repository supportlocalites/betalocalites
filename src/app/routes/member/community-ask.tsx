import { data, redirect } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { COMMUNITY_LIMITS, type CommunityProblem } from '@/lib/community-terms';
import { askQuestion, CommunityRefused } from '@/server/community.server';
import { tooFast } from '@/server/plan-pages.server';
import type { Route } from './+types/community-ask';

/**
 * Asking a Community question (D-62): needs an account (the member gate). The form is on
 * /community; anything refused goes back there with the reason in plain words.
 */
export async function loader() {
  return redirect('/community');
}

const back = (problem: CommunityProblem) => redirect(`/community?problem=${problem}`);

export async function action({ request, context }: Route.ActionArgs) {
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  const form = await request.formData();
  const title = String(form.get('title') ?? '').replace(/\s+/g, ' ').trim();
  const detail = String(form.get('detail') ?? '').trim() || null;
  const kind = String(form.get('kind') ?? '').trim() || null;
  if (title.length < COMMUNITY_LIMITS.title.min || title.length > COMMUNITY_LIMITS.title.max) {
    return back('title');
  }
  if (detail && detail.length > COMMUNITY_LIMITS.detail) return back('detail');
  if (kind && !/^[a-z0-9-]{1,80}$/.test(kind)) throw data(null, { status: 400 });
  if (await tooFast(env, member.userId)) return back('tooFast');
  try {
    const asked = await askQuestion(env, member.userId, { title, detail, kindSlug: kind });
    return redirect(asked.held ? '/community?asked=held' : `/community/${asked.id}`);
  } catch (err) {
    if (err instanceof CommunityRefused) return back(err.code);
    throw err;
  }
}
