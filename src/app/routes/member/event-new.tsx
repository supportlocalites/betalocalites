import { data, Link, redirect, useNavigation } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { EventForm, type EventFormErrors } from '@/components/EventForm';
import { SiteHeader } from '@/components/SiteHeader';
import { SLUG } from '@/lib/ids.mjs';
import { pageMeta } from '@/lib/meta';
import { TOO_FAST } from '@/lib/plan-terms';
import { PlanNotFound } from '@/server/acting.server';
import { dateWindow, parseEventForm } from '@/server/event-input';
import { addingChoices, createEvent, eventFormOptions } from '@/server/events.server';
import { formFields, refusal, todayIso, tooFast } from '@/server/plan-pages.server';
import type { Route } from './+types/event-new';

/**
 * Screen C2: plan an event (D-39). With ?add=<business> (from "Add to event" on a
 * business's page), that business goes on the new event's plan as Considering.
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
  const [options, add] = await Promise.all([
    eventFormOptions(env),
    businessToAdd(env, member.userId, new URL(request.url).searchParams.get('add')),
  ]);
  return { options, add, dates: dateWindow(todayIso()) };
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
  return redirect(`/events/${eventId}?created=1${added ? `&added=${encodeURIComponent(added.slug)}` : ''}`);
}

export default function NewEvent({ loaderData, actionData }: Route.ComponentProps) {
  const { options, add, dates } = loaderData;
  const busy = useNavigation().state !== 'idle';
  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <h1 className="title-1">Plan an event</h1>
        <div className="title-rule" aria-hidden="true" />
        <p className="muted">Only you can see your events. Add the businesses you’re thinking about as you find them.</p>
        {actionData?.error && (
          <p className="notice" role="alert">
            {actionData.error}
          </p>
        )}
        <EventForm
          mode="new"
          intent="create"
          options={options}
          fields={actionData?.fields ?? {}}
          errors={actionData?.errors ?? {}}
          dates={dates}
          busy={busy}
          submitLabel="Plan event"
        >
          {add && (
            <>
              <input type="hidden" name="add" value={add.slug} />
              <p>We’ll add {add.name} to this event as Considering.</p>
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
