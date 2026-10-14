import { data, Form, Link, redirect, useNavigation, useSearchParams } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { SiteHeader } from '@/components/SiteHeader';
import { isUuid, SLUG } from '@/lib/ids.mjs';
import { INQUIRY_EMAIL_FAILED, INQUIRY_LIMITS, INQUIRY_SENT, INQUIRY_SHARES } from '@/lib/inquiry-terms';
import { pageMeta } from '@/lib/meta';
import { shortDate, TOO_FAST } from '@/lib/plan-terms';
import { inquiryPage, saveInquiry, sendInquiryEmail } from '@/server/inquiries.server';
import { found, refusal, siteUrl, todayIso, tooFast } from '@/server/plan-pages.server';
import type { Route } from './+types/inquire';

/**
 * Screen C10: Inquire (ADR-024, D-04, D-05), for a business that isn't on Localites yet.
 * The person tells our team they're interested, with an optional note and event; the team
 * is emailed, and the person is told when the business joins. Says plainly that the
 * business itself isn't sent anything.
 */
export const meta: Route.MetaFunction = ({ loaderData }) => [
  ...pageMeta(loaderData ? `Interested in ${loaderData.vendor.name}?` : 'Inquire'),
  { name: 'robots', content: 'noindex' },
];

export async function loader({ params, context }: Route.LoaderArgs) {
  if (!SLUG.test(params.slug)) throw data(null, { status: 404 });
  const member = context.get(memberContext);
  const page = await found(inquiryPage(context.get(cloudflareContext).env, member.userId, params.slug));
  // On Localites now: contact them on their page (messages come later in Stage 2).
  if (page.vendor.claimed && !page.sent) throw redirect(`/vendors/${page.vendor.slug}`);
  return { ...page, today: todayIso() };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  if (!SLUG.test(params.slug)) throw data(null, { status: 404 });
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  const form = await request.formData();
  const note = String(form.get('note') ?? '').trim();
  const eventId = String(form.get('eventId') ?? '');
  if (note.length > INQUIRY_LIMITS.note) {
    return data({ error: `Please keep your note under ${INQUIRY_LIMITS.note} characters.` }, { status: 400 });
  }
  if (eventId && !isUuid(eventId)) return data({ error: 'Choose one of your events, or none.' }, { status: 400 });
  if (await tooFast(env, member.userId)) return data({ error: TOO_FAST }, { status: 429 });
  try {
    const sent = await saveInquiry(env, member.userId, params.slug, { note: note || null, eventId: eventId || null });
    // Before answering, so the page tells the truth about the email (ADR-024).
    const status = await sendInquiryEmail(env, member.userId, sent, siteUrl(env, request));
    return redirect(`/vendors/${sent.slug}/inquire${status === 'sent' ? '?sent=1' : ''}`);
  } catch (err) {
    const { error, status } = refusal(err);
    return data({ error }, { status });
  }
}

const day = new Intl.DateTimeFormat('en-CA', { dateStyle: 'long', timeZone: 'America/Toronto' });

export default function Inquire({ loaderData, actionData }: Route.ComponentProps) {
  const { vendor, events, sent, today } = loaderData;
  const busy = useNavigation().state !== 'idle';
  const [params] = useSearchParams();
  const back = (
    <p className="section-gap">
      <Link to={`/vendors/${vendor.slug}`} className="text-link">
        Back to {vendor.name}
      </Link>
    </p>
  );
  const error = actionData?.error && (
    <p className="notice" role="alert">
      {actionData.error}
    </p>
  );

  if (vendor.ownBusiness) {
    return (
      <>
        <SiteHeader />
        <main className="page narrow">
          <h1 className="title-1">{vendor.name}</h1>
          <div className="title-rule" aria-hidden="true" />
          <p>This is your own business.</p>
          {back}
        </main>
      </>
    );
  }

  // Already sent (the email went, or is on its way): say what happened, honestly.
  if (sent && sent.emailStatus !== 'failed') {
    return (
      <>
        <SiteHeader />
        <main className="page narrow">
          <h1 className="title-1">Interested in {vendor.name}</h1>
          <div className="title-rule" aria-hidden="true" />
          {params.has('sent') && (
            <p className="notice" role="status">
              Sent to our team.
            </p>
          )}
          <p>
            {sent.joinedTold || vendor.claimed
              ? `${vendor.name} has joined Localites. Contact them using the details on their page.`
              : INQUIRY_SENT}
          </p>
          <p className="muted">
            You told us on {day.format(new Date(sent.createdAt))}.{sent.sharedEvent ? ` Event mentioned: ${sent.sharedEvent}.` : ''}
          </p>
          {back}
        </main>
      </>
    );
  }

  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <h1 className="title-1">Interested in {vendor.name}?</h1>
        <div className="title-rule" aria-hidden="true" />
        {sent?.emailStatus === 'failed' && (
          <p className="notice" role="status">
            {INQUIRY_EMAIL_FAILED}
          </p>
        )}
        <p>
          {vendor.name} isn’t on Localites yet, so you can’t message them here. Tell our team you’re interested and we’ll invite them to
          join. We’ll let you know if they do. Meanwhile, you can contact them using the details on their page.
        </p>
        {error}
        <Form method="post" noValidate>
          <div className="field">
            <label htmlFor="note" className="field-label">
              A note for our team (optional)
            </label>
            <p className="field-hint" id="note-hint">
              For example, what you’re looking for.
            </p>
            <textarea
              id="note"
              name="note"
              className="input"
              maxLength={INQUIRY_LIMITS.note}
              aria-describedby="note-hint"
              defaultValue={sent?.note ?? ''}
            />
          </div>
          {events.length > 0 && (
            <div className="field">
              <label htmlFor="eventId" className="field-label">
                Mention one of your events (optional)
              </label>
              <select id="eventId" name="eventId" className="input" defaultValue="">
                <option value="">No event</option>
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {`${e.name} · ${shortDate(e.date, today)}`}
                  </option>
                ))}
              </select>
            </div>
          )}
          <p className="muted">{INQUIRY_SHARES}</p>
          <p className="section-gap">
            <button type="submit" className="button button-primary" disabled={busy}>
              {busy ? 'Sending…' : sent ? 'Try sending again' : 'Send to our team'}
            </button>
          </p>
        </Form>
        {back}
      </main>
    </>
  );
}
