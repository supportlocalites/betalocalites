import { data, Form, Link, redirect, useNavigation } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { SiteHeader } from '@/components/SiteHeader';
import { isUuid } from '@/lib/ids.mjs';
import { pageMeta } from '@/lib/meta';
import { tellWords, TOO_FAST } from '@/lib/plan-terms';
import { cancelEvent, eventForEdit } from '@/server/events.server';
import { sendBookingNotices } from '@/server/plan-emails.server';
import { afterwards, found, refusal, siteUrl, tooFast } from '@/server/plan-pages.server';
import type { Route } from './+types/event-cancel';
import styles from './plan.module.css';

/**
 * Cancelling an event: final in 2A. The businesses marked booked are told (D-40); guests aren't
 * told automatically, but the host can let them know next (C10, D-54).
 */
export const meta: Route.MetaFunction = ({ loaderData }) => [
  ...pageMeta(loaderData ? `Cancel ${loaderData.title}?` : 'Cancel your event'),
  { name: 'robots', content: 'noindex' },
];

export async function loader({ params, context }: Route.LoaderArgs) {
  if (!isUuid(params.id)) throw data(null, { status: 404 });
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  const event = await found(eventForEdit(env, member.userId, params.id));
  if (event.cancelled) throw redirect(`/events/${params.id}`);
  return { id: params.id, title: event.values.title, tell: tellWords(event.booked, 'cancel') };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  if (!isUuid(params.id)) throw data(null, { status: 404 });
  const member = context.get(memberContext);
  const { env, ctx } = context.get(cloudflareContext);
  const form = await request.formData();
  if (form.get('intent') !== 'cancel') throw data(null, { status: 400 });
  if (await tooFast(env, member.userId)) return data({ error: TOO_FAST }, { status: 429 });
  try {
    const notices = await cancelEvent(env, member.userId, params.id);
    const site = siteUrl(env, request);
    afterwards(ctx, sendBookingNotices(env, site, notices), 'event cancelled emails');
  } catch (err) {
    const { error, status } = refusal(err);
    return data({ error }, { status });
  }
  return redirect(`/events/${params.id}/tell-guests?cancelled=1`);
}

export default function CancelEvent({ loaderData, actionData }: Route.ComponentProps) {
  const { id, title, tell } = loaderData;
  const busy = useNavigation().state !== 'idle';
  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <h1 className="title-1">Cancel {title}?</h1>
        <div className="title-rule" aria-hidden="true" />
        {actionData?.error && (
          <p className="notice" role="alert">
            {actionData.error}
          </p>
        )}
        {tell.map((line) => (
          <p key={line}>{line}</p>
        ))}
        <p>Your guests aren’t told automatically: next, you can send them a message, or have us email the ones whose email you added.</p>
        <p>You can’t undo this. The plan stays here for your records.</p>
        <Form method="post" className={styles.actions}>
          <input type="hidden" name="intent" value="cancel" />
          <button type="submit" className="button button-primary" disabled={busy}>
            {busy ? 'Cancelling…' : 'Cancel event'}
          </button>
          <Link to={`/events/${id}`} className="button button-secondary">
            Keep it
          </Link>
        </Form>
      </main>
    </>
  );
}
