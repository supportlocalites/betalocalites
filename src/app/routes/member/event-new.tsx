import { data, Link, redirect, useNavigation } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { EventForm, type EventFormErrors, eventFields } from '@/components/EventForm';
import { SiteHeader } from '@/components/SiteHeader';
import { isUuid, SLUG } from '@/lib/ids.mjs';
import { pageMeta } from '@/lib/meta';
import { EVENTS_PRIVATE, TOO_FAST } from '@/lib/plan-terms';
import { PlanNotFound } from '@/server/acting.server';
import { dateWindow, parseEventForm } from '@/server/event-input';
import { addingChoices, copyBusinesses, copySource, createEvent, eventFormOptions } from '@/server/events.server';
import { formFields, refusal, todayIso, tooFast } from '@/server/plan-pages.server';
import type { Route } from './+types/event-new';

/**
 * Screen C2: plan an event (D-39). With ?add=<business> (from "Add to event" on a
 * business's page), that business goes on the new event's plan as Considering. With
 * ?copy=<event> (M10, D-54: "Copy this event" on a cancelled one), the form starts from that
 * event's details, and its businesses go on the new plan as Considering, never marked booked.
 */
export const meta: Route.MetaFunction = () => [...pageMeta('Plan an event'), { name: 'robots', content: 'noindex' }];

/** The business to add, if the address names one that's listed and isn't this person's own. */
async function businessToAdd(env: Parameters<typeof addingChoices>[0], userId: string, slug: string | null) {
  if (!slug || !SLUG.test(slug)) return null;
  try {
    const { vendor } = await addingChoices(env, userId, slug);
    return vendor.ownBusiness ? null : { slug: vendor.slug, name: vendor.name };
  } catch (err) {
    if (err instanceof PlanNotFound) return null;
    throw err;
  }
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  const params = new URL(request.url).searchParams;
  const copyId = params.get('copy');
  const dates = dateWindow(todayIso());
  const [options, add, copy] = await Promise.all([
    eventFormOptions(env),
    businessToAdd(env, member.userId, params.get('add')),
    copyId && isUuid(copyId) ? copySource(env, member.userId, copyId).catch(() => null) : null,
  ]);
  // A date outside the window (an event long past) is left for the person to choose.
  const copied = copy
    ? { ...copy.values, date: copy.values.date >= dates.min && copy.values.date <= dates.max ? copy.values.date : '' }
    : null;
  return { options, add, dates, copy: copied && copy ? { fields: eventFields(copied), businesses: copy.slugs, from: copyId } : null };
}

export async function action({ request, context }: Route.ActionArgs) {
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  const fields = formFields(await request.formData());
  if (fields.intent !== 'create') throw data(null, { status: 400 });
  if (await tooFast(env, member.userId)) return data({ error: TOO_FAST, errors: {} as EventFormErrors, fields }, { status: 429 });
  const parsed = parseEventForm(fields, todayIso());
  if (!parsed.ok) return data({ error: null, errors: parsed.errors, fields }, { status: 400 });
  const add = fields.add && SLUG.test(fields.add) ? fields.add : null;
  let eventId: string;
  let added: { slug: string } | null;
  try {
    ({ eventId, added } = await createEvent(env, member.userId, parsed.values, add));
  } catch (err) {
    const { error, status } = refusal(err);
    return data({ error, errors: {} as EventFormErrors, fields }, { status });
  }
  // A copy (M10): the original's businesses, as this person (their own event only), in one step.
  if (fields.copyFrom && isUuid(fields.copyFrom)) {
    const n = await copyBusinesses(env, member.userId, fields.copyFrom, eventId).catch(() => 0);
    return redirect(`/events/${eventId}?created=1&copied=${n}`);
  }
  return redirect(`/events/${eventId}?created=1${added ? `&added=${encodeURIComponent(added.slug)}` : ''}`);
}

export default function NewEvent({ loaderData, actionData }: Route.ComponentProps) {
  const { options, add, dates, copy } = loaderData;
  const busy = useNavigation().state !== 'idle';
  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <h1 className="title-1">{copy ? 'Copy your event' : 'Plan an event'}</h1>
        <div className="title-rule" aria-hidden="true" />
        <p className="muted">{EVENTS_PRIVATE} Add the businesses you’re thinking about as you find them.</p>
        {actionData?.error && (
          <p className="notice" role="alert">
            {actionData.error}
          </p>
        )}
        <EventForm
          mode="new"
          intent="create"
          options={options}
          fields={actionData?.fields ?? copy?.fields ?? {}}
          errors={actionData?.errors ?? {}}
          dates={dates}
          busy={busy}
          submitLabel="Plan event"
        >
          {add && !copy && (
            <>
              <input type="hidden" name="add" value={add.slug} />
              <p>We’ll add {add.name} to this event as Considering.</p>
            </>
          )}
          {copy && (
            <>
              <input type="hidden" name="copyFrom" value={copy.from ?? ''} />
              <p>
                {copy.businesses.length > 0
                  ? `The ${copy.businesses.length === 1 ? 'business' : `${copy.businesses.length} businesses`} from your cancelled event go on the new plan as Considering. Mark them booked again once you’ve arranged it with them.`
                  : 'Change anything you need, then plan the new event.'}{' '}
                Your guest list isn’t copied.
              </p>
            </>
          )}
        </EventForm>
        <p className="section-gap">
          <Link to="/events" className="text-link">
            My events
          </Link>
        </p>
      </main>
    </>
  );
}
