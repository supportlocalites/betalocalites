import { data, Form, Link, redirect, useNavigation, useSearchParams } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { EventForm, type EventFormErrors } from '@/components/EventForm';
import { SiteHeader } from '@/components/SiteHeader';
import { isUuid, SLUG } from '@/lib/ids.mjs';
import { pageMeta } from '@/lib/meta';
import { shortDate, STATUS_WORDS, TOO_FAST } from '@/lib/plan-terms';
import { dateWindow, parseQuickEventForm } from '@/server/event-input';
import { addingChoices, addToEvent, createEvent, eventFormOptions, saveVendor, unsaveVendor } from '@/server/events.server';
import { formFields, found, refusal, todayIso, tooFast } from '@/server/plan-pages.server';
import type { Route } from './+types/vendor-add';
import { SquarePhoto } from '@/components/SquarePhoto';
import styles from './plan.module.css';

/**
 * Screen C4: add a business to one of your events, in two taps (choose the event, then
 * "Add to this event"), or start a new event with it; and Save (C6). Both are private:
 * the business isn't told (B §4).
 */
export const meta: Route.MetaFunction = ({ loaderData }) => [
  ...pageMeta(loaderData ? `Add ${loaderData.vendor.name} to an event` : 'Add to an event'),
  { name: 'robots', content: 'noindex' },
];

export async function loader({ params, context }: Route.LoaderArgs) {
  if (!SLUG.test(params.slug)) throw data(null, { status: 404 });
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  const [choices, options] = await Promise.all([found(addingChoices(env, member.userId, params.slug)), eventFormOptions(env)]);
  return { ...choices, options, dates: dateWindow(todayIso()), today: todayIso() };
}

const INTENTS = ['add', 'create', 'save', 'unsave'] as const;
type Intent = (typeof INTENTS)[number];

export async function action({ request, params, context }: Route.ActionArgs) {
  if (!SLUG.test(params.slug)) throw data(null, { status: 404 });
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  const fields = formFields(await request.formData());
  const intent = fields.intent as Intent;
  if (!INTENTS.includes(intent)) throw data(null, { status: 400 });
  const reply = (error: string | null, status: number, errors: EventFormErrors = {}) => data({ intent, error, errors, fields }, { status });
  if (await tooFast(env, member.userId)) return reply(TOO_FAST, 429);
  const slug = params.slug;
  try {
    if (intent === 'save') {
      await saveVendor(env, member.userId, slug);
      return redirect(fields.return === 'profile' ? `/vendors/${slug}?saved=1` : `/vendors/${slug}/add?saved=1`);
    }
    if (intent === 'unsave') {
      await unsaveVendor(env, member.userId, slug);
      return redirect(`/vendors/${slug}/add?unsaved=1`);
    }
    if (intent === 'add') {
      const eventId = fields.eventId ?? '';
      if (!isUuid(eventId)) return reply('Choose one of your events.', 400);
      const result = await addToEvent(env, member.userId, eventId, slug);
      return redirect(`/vendors/${slug}?${result === 'already' ? 'already' : 'added'}=${eventId}`);
    }
    const parsed = parseQuickEventForm(fields, todayIso());
    if (!parsed.ok) return reply(null, 400, parsed.errors);
    const { eventId } = await createEvent(env, member.userId, parsed.values, slug);
    return redirect(`/vendors/${slug}?added=${eventId}`);
  } catch (err) {
    const { error, status } = refusal(err);
    return reply(error, status);
  }
}

export default function AddToEvent({ loaderData, actionData, params }: Route.ComponentProps) {
  const { vendor, events, options, dates, today } = loaderData;
  const nav = useNavigation();
  const [query] = useSearchParams();
  const done = actionData
    ? null
    : query.has('saved')
      ? 'Saved. Only you can see your saved businesses.'
      : query.has('unsaved')
        ? 'Removed from your saved businesses.'
        : null;
  const busy = nav.state !== 'idle';
  const free = events.filter((e) => e.status === null);
  const chosen = free[0]?.id;
  const failed = actionData?.intent;
  const errorFor = (intents: string[]) =>
    actionData?.error && failed && intents.includes(failed) ? (
      <p className="notice" role="alert">
        {actionData.error}
      </p>
    ) : null;
  const quickForm = (
    <EventForm
      mode="quick"
      intent="create"
      options={options}
      fields={failed === 'create' ? actionData!.fields : {}}
      errors={failed === 'create' ? actionData!.errors : {}}
      dates={dates}
      busy={busy}
      submitLabel="Plan event and add"
    />
  );

  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <div className={styles.withPhoto}>
          <SquarePhoto photo={vendor.photo} alt="" />
          <div className={styles.rowBody}>
            <h1 className="title-1">Add {vendor.name} to an event</h1>
            <div className="title-rule" aria-hidden="true" />
          </div>
        </div>
        {done && (
          <p className="notice" role="status">
            {done}{' '}
            <Link to="/saved" className="text-link">
              See saved
            </Link>
          </p>
        )}

        {vendor.ownBusiness ? (
          <p>This is your business, so it can’t go on your own event plan.</p>
        ) : events.length > 0 ? (
          <>
            {errorFor(['add'])}
            <Form method="post">
              <input type="hidden" name="intent" value="add" />
              <fieldset className={styles.choices}>
                <legend>Which event?</legend>
                {events.map((e) => (
                  <label key={e.id} className={styles.choice}>
                    <input type="radio" name="eventId" value={e.id} defaultChecked={e.id === chosen} disabled={e.status !== null} />
                    <span>
                      <span>{[e.name, shortDate(e.date, today), e.town].join(' · ')}</span>
                      {e.status && <span className={styles.meta}>Already on this plan ({STATUS_WORDS[e.status]})</span>}
                    </span>
                  </label>
                ))}
              </fieldset>
              {free.length > 0 ? (
                <button type="submit" className={`button button-primary ${styles.wide}`} disabled={busy}>
                  {busy && nav.formData?.get('intent') === 'add' ? 'Adding…' : 'Add to this event'}
                </button>
              ) : (
                <p className="muted">{vendor.name} is already on all your events.</p>
              )}
            </Form>
            <details className={`${styles.more} section-gap`} open={failed === 'create'}>
              <summary>Or start a new event</summary>
              {errorFor(['create'])}
              {quickForm}
            </details>
          </>
        ) : (
          <>
            <p className="muted">Start an event and we’ll add {vendor.name} to it as Considering.</p>
            {errorFor(['create'])}
            {quickForm}
          </>
        )}

        <section aria-labelledby="save" className={styles.section}>
          <h2 id="save" className="label">
            Save for later
          </h2>
          {errorFor(['save', 'unsave'])}
          <Form method="post" className={styles.rowActions}>
            {vendor.saved ? (
              <>
                <span>Saved.</span>
                <input type="hidden" name="intent" value="unsave" />
                <button type="submit" className={styles.textButton} disabled={busy}>
                  Remove from saved
                </button>
              </>
            ) : (
              <>
                <input type="hidden" name="intent" value="save" />
                <button type="submit" className="button button-secondary" disabled={busy}>
                  Save
                </button>
              </>
            )}
          </Form>
          <p className="muted">Saving is private. {vendor.name} isn’t told.</p>
        </section>

        <p className={styles.footer}>Adding a business doesn’t contact them. Call them or visit their website to ask about your date.</p>
        <p>
          <Link to={`/vendors/${params.slug}`} className="text-link">
            Back to {vendor.name}
          </Link>
        </p>
      </main>
    </>
  );
}
