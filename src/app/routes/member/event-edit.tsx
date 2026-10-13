import { data, Link, redirect, useNavigation } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { EventForm, type EventFormErrors, eventFields } from '@/components/EventForm';
import { SiteHeader } from '@/components/SiteHeader';
import { isUuid } from '@/lib/ids.mjs';
import { pageMeta } from '@/lib/meta';
import { tellWords, TOO_FAST } from '@/lib/plan-terms';
import { dateWindow, parseEventForm } from '@/server/event-input';
import { eventForEdit, eventFormOptions, updateEvent } from '@/server/events.server';
import { sendBookingNotice } from '@/server/plan-emails.server';
import { afterwards, formFields, found, refusal, siteUrl, todayIso, tooFast } from '@/server/plan-pages.server';
import type { Route } from './+types/event-edit';

/**
 * Screen C2, editing an event's details. Only the boxes that changed are saved. When the
 * date or the town changes, the businesses marked booked are told (D-40); nothing else is.
 */
export const meta: Route.MetaFunction = ({ loaderData }) => [
  ...pageMeta(loaderData ? `Edit ${loaderData.title}` : 'Edit your event'),
  { name: 'robots', content: 'noindex' },
];

const withStored = (w: { min: string; max: string }, stored: string) => ({ min: stored < w.min ? stored : w.min, max: w.max });

export async function loader({ params, context }: Route.LoaderArgs) {
  if (!isUuid(params.id)) throw data(null, { status: 404 });
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  const event = await found(eventForEdit(env, member.userId, params.id));
  if (event.cancelled) throw redirect(`/events/${params.id}`);
  const options = await eventFormOptions(env, event.values.typeId, event.values.townId);
  return {
    id: params.id,
    title: event.values.title,
    fields: eventFields(event.values),
    tell: tellWords(event.booked, 'change'),
    options,
    // An older event keeps its own date: the box allows it even once it's outside the window.
    dates: withStored(dateWindow(todayIso()), event.values.date),
  };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  if (!isUuid(params.id)) throw data(null, { status: 404 });
  const member = context.get(memberContext);
  const { env, ctx } = context.get(cloudflareContext);
  const fields = formFields(await request.formData());
  if (fields.intent !== 'save') throw data(null, { status: 400 });
  if (await tooFast(env, member.userId)) return data({ error: TOO_FAST, errors: {} as EventFormErrors, fields }, { status: 429 });
  // Keeping the stored date is always allowed, even once it's more than 60 days ago.
  const stored = await found(eventForEdit(env, member.userId, params.id));
  const parsed = parseEventForm(fields, todayIso(), stored.values.date);
  if (!parsed.ok) return data({ error: null, errors: parsed.errors, fields }, { status: 400 });
  try {
    const notices = await updateEvent(env, member.userId, params.id, parsed.values);
    const site = siteUrl(env, request);
    for (const notice of notices) afterwards(ctx, sendBookingNotice(env, site, notice), 'event change email');
  } catch (err) {
    const { error, status } = refusal(err);
    return data({ error, errors: {} as EventFormErrors, fields }, { status });
  }
  return redirect(`/events/${params.id}?saved=1`);
}

export default function EditEvent({ loaderData, actionData }: Route.ComponentProps) {
  const { id, title, fields, tell, options, dates } = loaderData;
  const busy = useNavigation().state !== 'idle';
  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <h1 className="title-1">Edit {title}</h1>
        <div className="title-rule" aria-hidden="true" />
        {actionData?.error && (
          <p className="notice" role="alert">
            {actionData.error}
          </p>
        )}
        <EventForm
          mode="edit"
          intent="save"
          options={options}
          fields={actionData?.fields ?? fields}
          errors={actionData?.errors ?? {}}
          dates={dates}
          busy={busy}
          submitLabel="Save changes"
        >
          {tell.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </EventForm>
        <p className="section-gap">
          <Link to={`/events/${id}`} className="text-link">
            Back to the plan
          </Link>{' '}
          ·{' '}
          <Link to={`/events/${id}/cancel`} className="text-link">
            Cancel this event
          </Link>
        </p>
      </main>
    </>
  );
}
