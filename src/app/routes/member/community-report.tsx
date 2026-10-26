import { data, Form, Link, redirect, useNavigation, useSearchParams } from 'react-router';
import { TopBar } from '@/components/TopBar';
import { cloudflareContext, memberContext } from '@/app/context';
import { COMMUNITY_LIMITS, problemWords, REPORT_REASONS, type ReportReason } from '@/lib/community-terms';
import { isUuid } from '@/lib/ids.mjs';
import { pageMeta } from '@/lib/meta';
import { CommunityRefused, postToReport, reportPost } from '@/server/community.server';
import { tooFast } from '@/server/plan-pages.server';
import type { Route } from './+types/community-report';

/**
 * Reporting a Community question or answer (D-62): once each, never your own; our team decides
 * (/admin/community). Needs an account (the member gate).
 */
export const meta: Route.MetaFunction = () => [...pageMeta('Report a post'), { name: 'robots', content: 'noindex' }];

function postOf(request: Request, id: string): { kind: 'question' | 'answer'; id: string } {
  const answer = new URL(request.url).searchParams.get('answer');
  return answer ? { kind: 'answer', id: answer } : { kind: 'question', id };
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  if (!isUuid(params.id)) throw data(null, { status: 404 });
  const post = postOf(request, params.id);
  const found = await postToReport(context.get(cloudflareContext).env, context.get(memberContext).userId, post);
  if (!found || found.questionId !== params.id) throw data(null, { status: 404 });
  return { post, found };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  if (!isUuid(params.id)) throw data(null, { status: 404 });
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  const post = postOf(request, params.id);
  const form = await request.formData();
  const reason = String(form.get('reason') ?? '');
  const details = String(form.get('details') ?? '').trim().slice(0, COMMUNITY_LIMITS.reportDetails) || null;
  if (!Object.hasOwn(REPORT_REASONS, reason)) return data({ error: 'Please choose what’s wrong.' }, { status: 400 });
  if (await tooFast(env, member.userId)) return data({ error: problemWords('tooFast') }, { status: 429 });
  const found = await postToReport(env, member.userId, post);
  if (!found || found.questionId !== params.id) throw data(null, { status: 404 });
  try {
    await reportPost(env, member.userId, post, reason as ReportReason, details);
  } catch (err) {
    if (err instanceof CommunityRefused) return data({ error: err.message }, { status: err.status });
    throw err;
  }
  return redirect(`/community/${params.id}/report?${post.kind === 'answer' ? `answer=${post.id}&` : ''}sent=1`);
}

export default function CommunityReport({ loaderData: { post, found }, actionData, params }: Route.ComponentProps) {
  const busy = useNavigation().state === 'submitting';
  const sent = useSearchParams()[0].has('sent');
  return (
    <>
      <TopBar />
      <main className="page narrow">
      <p>
        <Link to={`/community/${params.id}`} className="text-link">
          ← Back to the question
        </Link>
      </p>
      <h1 className="title-1">Report {post.kind === 'answer' ? 'an answer' : 'a question'}</h1>
      <div className="title-rule" aria-hidden="true" />
      <blockquote className="muted">
        “{found.words}” · {found.author}
      </blockquote>
      {sent ? (
        <p className="notice" role="status">
          Thank you. Our team will look at it. We don’t tell the person who reported it.
        </p>
      ) : (
        <Form method="post">
          {actionData?.error && (
            <p className="field-error" role="alert">
              {actionData.error}
            </p>
          )}
          <fieldset className="field">
            <legend className="field-label">What’s wrong?</legend>
            {Object.entries(REPORT_REASONS).map(([value, label]) => (
              <label key={value} className="muted">
                <input type="radio" name="reason" value={value} required /> {label}
              </label>
            ))}
          </fieldset>
          <div className="field">
            <label htmlFor="details" className="field-label">
              Anything to add (optional)
            </label>
            <textarea id="details" name="details" className="input" maxLength={COMMUNITY_LIMITS.reportDetails} />
            <p className="field-hint">Only our team sees this. The person who wrote it isn’t told who reported it.</p>
          </div>
          <p>
            <button type="submit" className="button button-primary" disabled={busy}>
              Send report
            </button>
          </p>
        </Form>
      )}
      </main>
    </>
  );
}
