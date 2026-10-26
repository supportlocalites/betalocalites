import { data, redirect } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { COMMUNITY_LIMITS, type CommunityProblem } from '@/lib/community-terms';
import { isUuid } from '@/lib/ids.mjs';
import { answerQuestion, businessChoices, CommunityRefused, takeDownOwn, voteOn } from '@/server/community.server';
import { tooFast } from '@/server/plan-pages.server';
import type { Route } from './+types/community-act';

/**
 * What people do on a Community question (D-62): answer it, vote on an answer, or take their own
 * question or answer down. Needs an account (the member gate); the database checks each one is
 * theirs to do (0061). Back to the question afterwards, with any reason in plain words.
 */
export async function loader({ params }: Route.LoaderArgs) {
  return redirect(isUuid(params.id) ? `/community/${params.id}` : '/community');
}

export async function action({ request, params, context }: Route.ActionArgs) {
  if (!isUuid(params.id)) throw data(null, { status: 404 });
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  const here = `/community/${params.id}`;
  const back = (problem: CommunityProblem, extra = '') => redirect(`${here}?problem=${problem}${extra}`);
  const form = await request.formData();
  const intent = String(form.get('intent') ?? '');
  if (await tooFast(env, member.userId)) return back('tooFast');
  try {
    if (intent === 'vote') {
      const answer = String(form.get('answer') ?? '');
      const value = Number(form.get('value'));
      if (!isUuid(answer) || (value !== 1 && value !== -1)) throw data(null, { status: 400 });
      await voteOn(env, member.userId, answer, value);
      return redirect(`${here}#a-${answer}`);
    }
    if (intent === 'remove-question') {
      await takeDownOwn(env, member.userId, 'question', params.id);
      return redirect('/community?removed=1');
    }
    if (intent === 'remove-answer') {
      const answer = String(form.get('answer') ?? '');
      if (!isUuid(answer)) throw data(null, { status: 400 });
      await takeDownOwn(env, member.userId, 'answer', answer);
      return redirect(here);
    }
    if (intent === 'answer') {
      const body = String(form.get('body') ?? '').trim();
      if (body.length < COMMUNITY_LIMITS.body.min || body.length > COMMUNITY_LIMITS.body.max) return back('body', '&answer=1');
      let vendorSlug: string | null = null;
      let businessName: string | null = null;
      if (form.get('mode') !== 'advice') {
        const picked = String(form.get('vendor') ?? '').trim();
        const find = String(form.get('find') ?? '').replace(/\s+/g, ' ').trim();
        const typed = String(form.get('businessName') ?? '').replace(/\s+/g, ' ').trim();
        if ([picked, find, typed].filter(Boolean).length > 1) return back('chooseOne', '&answer=1');
        if (picked) {
          if (!/^[a-z0-9-]{1,120}$/.test(picked)) throw data(null, { status: 400 });
          vendorSlug = picked;
        } else if (find) {
          // A name chosen from the list: the business listed with that name (never their own).
          const match = (await businessChoices(env, member.userId)).all.find((b) => b.name.toLowerCase() === find.toLowerCase());
          if (!match) return back('notFound', '&answer=1');
          vendorSlug = match.slug;
        } else if (typed) {
          if (typed.length < COMMUNITY_LIMITS.businessName.min || typed.length > COMMUNITY_LIMITS.businessName.max) return back('name', '&answer=1');
          businessName = typed;
        }
      }
      const posted = await answerQuestion(env, member.userId, params.id, { body, vendorSlug, businessName });
      return redirect(posted.held ? `${here}?posted=held` : `${here}#a-${posted.id}`);
    }
    throw data(null, { status: 400 });
  } catch (err) {
    if (err instanceof CommunityRefused) return err.status === 404 ? redirect('/community') : back(err.code);
    throw err;
  }
}
