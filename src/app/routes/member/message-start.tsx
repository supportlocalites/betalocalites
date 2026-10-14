import { data, Form, Link, redirect, useNavigation } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { SiteHeader } from '@/components/SiteHeader';
import { isUuid, SLUG } from '@/lib/ids.mjs';
import { FileField, useFileSend } from '@/components/MessageThread';
import { MESSAGE_LIMITS, MESSAGE_REFUSALS, NO_PAYMENTS_IN_CONVERSATION, SHARE_CAREFULLY } from '@/lib/message-terms';
import { pageMeta } from '@/lib/meta';
import { shortDate, TOO_FAST } from '@/lib/plan-terms';
import { filesOn, MAX_FILE_UPLOAD, readAttachment } from '@/server/conversation-files.server';
import { emailAboutMessage, readBody, startConversation, startPage } from '@/server/messages.server';
import { afterwards, found, refusal, siteUrl, todayIso, tooFast } from '@/server/plan-pages.server';
import type { Route } from './+types/message-start';

/**
 * Screen C9: message a business that has joined Localites (Stage 2B, D-13). One
 * conversation per person and business: if there's one already, this goes to it. A business
 * that hasn't joined gets Inquire instead (ADR-024).
 */
export const meta: Route.MetaFunction = ({ loaderData }) => [
  ...pageMeta(loaderData ? `Message ${loaderData.vendor.name}` : 'Message a business'),
  { name: 'robots', content: 'noindex' },
];

export async function loader({ params, context }: Route.LoaderArgs) {
  if (!SLUG.test(params.slug)) throw data(null, { status: 404 });
  const member = context.get(memberContext);
  const page = await found(startPage(context.get(cloudflareContext).env, member.userId, params.slug));
  if (page.existing) throw redirect(`/messages/${page.existing}`);
  if (!page.vendor.open) throw redirect(`/vendors/${page.vendor.slug}/inquire`);
  return { ...page, today: todayIso(), canAttach: filesOn(context.get(cloudflareContext).env) };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  if (!SLUG.test(params.slug)) throw data(null, { status: 404 });
  const member = context.get(memberContext);
  const { env, ctx } = context.get(cloudflareContext);
  if (Number(request.headers.get('content-length') ?? 0) > MAX_FILE_UPLOAD) {
    return data({ error: MESSAGE_REFUSALS.pdfTooBig }, { status: 413 });
  }
  const form = await request.formData();
  const file = await readAttachment(form.get('file'));
  if (file && 'error' in file) return data({ error: file.error }, { status: 400 });
  const read = readBody(form, Boolean(file));
  if ('error' in read) return data({ error: read.error }, { status: 400 });
  const eventId = String(form.get('eventId') ?? '');
  if (eventId && !isUuid(eventId)) return data({ error: 'Choose one of your events, or none.' }, { status: 400 });
  if (await tooFast(env, member.userId)) return data({ error: TOO_FAST }, { status: 429 });
  try {
    const written = await startConversation(env, member.userId, params.slug, { body: read.body, eventId: eventId || null, file });
    afterwards(ctx, emailAboutMessage(env, { side: 'person', userId: member.userId }, written, siteUrl(env, request)), 'message email');
    return redirect(`/messages/${written.conversationId}?sent=${written.messageId}`);
  } catch (err) {
    const { error, status } = refusal(err);
    return data({ error }, { status });
  }
}

export default function MessageStart({ loaderData, actionData }: Route.ComponentProps) {
  const { vendor, events, today, canAttach } = loaderData;
  const busy = useNavigation().state !== 'idle';
  const { send, problem, preparing } = useFileSend();
  const error = problem ?? actionData?.error;
  const back = (
    <p className="section-gap">
      <Link to={`/vendors/${vendor.slug}`} className="text-link">
        Back to {vendor.name}
      </Link>
    </p>
  );
  if (vendor.ownBusiness) {
    return (
      <>
        <SiteHeader />
        <main className="page narrow">
          <h1 className="title-1">{vendor.name}</h1>
          <div className="title-rule" aria-hidden="true" />
          <p>This is your own business. You’ll find the messages people send it under My business.</p>
          {back}
        </main>
      </>
    );
  }
  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <h1 className="title-1">Message {vendor.name}</h1>
        <div className="title-rule" aria-hidden="true" />
        <p>Your message goes to {vendor.name}’s team on Localites. They’ll see your name, and reply here; we’ll email you when they do.</p>
        {error && (
          <p className="notice" role="alert">
            {error}
          </p>
        )}
        <Form method="post" encType="multipart/form-data" onSubmit={send} noValidate>
          <div className="field">
            <label htmlFor="body" className="field-label">
              Your message
            </label>
            <textarea id="body" name="body" className="input" maxLength={MESSAGE_LIMITS.body} />
          </div>
          {events.length > 0 && (
            <div className="field">
              <label htmlFor="eventId" className="field-label">
                About one of your events (optional)
              </label>
              <p className="field-hint" id="event-hint">
                {vendor.name} sees only the date, the town and about how many guests. Never your event’s name, where it is, the ages, your
                budget or your notes.
              </p>
              <select id="eventId" name="eventId" className="input" defaultValue="" aria-describedby="event-hint">
                <option value="">No event</option>
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {`${e.name} · ${shortDate(e.date, today)}`}
                  </option>
                ))}
              </select>
            </div>
          )}
          {canAttach && <FileField />}
          <p className="muted">{NO_PAYMENTS_IN_CONVERSATION}</p>
          <p className="muted">{SHARE_CAREFULLY}</p>
          <p className="section-gap">
            <button type="submit" className="button button-primary" disabled={busy || preparing}>
              {preparing ? 'Getting the photo ready…' : busy ? 'Sending…' : 'Send'}
            </button>
          </p>
        </Form>
        {back}
      </main>
    </>
  );
}
