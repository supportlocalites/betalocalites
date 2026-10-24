import { data, Form, Link, redirect, useNavigation } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { SiteHeader } from '@/components/SiteHeader';
import { pageMeta } from '@/lib/meta';
import { isUuid } from '@/lib/ids.mjs';
import { longDate, TOO_FAST } from '@/lib/plan-terms';
import { safeBack } from '@/lib/theme';
import { readShortlist } from '@/server/browse.server';
import { actingAs } from '@/server/acting.server';
import { myEvents, saveVendor, unsaveVendor } from '@/server/events.server';
import { refusal, todayIso, tooFast } from '@/server/plan-pages.server';
import { addToShortlist, clearShortlist, removeFromShortlist, shortlistToEvent } from '@/server/shortlist.server';
import { smallPhotoUrl } from '@/server/photo-store.server';
import type { Route } from './+types/shortlist';
import styles from './shortlist.module.css';

/**
 * Your shortlist (D-57): the businesses added with the + on Browse local, private to you,
 * moved onto one of your events (or a new one) as Considering. Also where the card buttons
 * post: the + (add, remove) and the bookmark (save as a favourite, remove), each as the
 * signed-in person only. From a page with scripts the answer is just "done"; without, it goes
 * back to the page it came from.
 */
export const meta: Route.MetaFunction = () => [...pageMeta('Your shortlist'), { name: 'robots', content: 'noindex' }];

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export async function loader({ context }: Route.LoaderArgs) {
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  const [items, events] = await Promise.all([
    actingAs(env, { side: 'person', userId: member.userId }, (tx) => readShortlist(tx, member.userId)),
    myEvents(env, member.userId),
  ]);
  return {
    items: items.map((i) => ({ ...i, photo: smallPhotoUrl(env, i.photo) })),
    events: events.upcoming.map((e) => ({ id: e.id, name: e.name, date: e.date, town: e.town })),
    today: todayIso(),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  const form = await request.formData();
  const intent = String(form.get('intent') ?? '');
  const slug = String(form.get('slug') ?? '');
  const inline = form.get('inline') === '1';
  const back = safeBack(String(form.get('back') ?? '/shortlist').slice(0, 2000));
  if (await tooFast(env, member.userId)) return data({ error: TOO_FAST }, { status: 429 });
  try {
    if (intent === 'to-event') {
      const eventId = String(form.get('eventId') ?? '');
      if (!isUuid(eventId)) throw data(null, { status: 400 });
      const n = await shortlistToEvent(env, member.userId, eventId);
      return redirect(`/events/${eventId}?moved=${n}`);
    }
    if (intent === 'clear') {
      await clearShortlist(env, member.userId);
      return inline ? data({ error: null }) : redirect(back);
    }
    if (!SLUG.test(slug)) throw data(null, { status: 400 });
    if (intent === 'add') await addToShortlist(env, member.userId, slug);
    else if (intent === 'remove') await removeFromShortlist(env, member.userId, slug);
    else if (intent === 'save') await saveVendor(env, member.userId, slug);
    else if (intent === 'unsave') await unsaveVendor(env, member.userId, slug);
    else throw data(null, { status: 400 });
  } catch (err) {
    const { error, status } = refusal(err);
    return data({ error }, { status });
  }
  return inline ? data({ error: null }) : redirect(back);
}

export default function Shortlist({ loaderData, actionData }: Route.ComponentProps) {
  const { items, events, today } = loaderData;
  const busy = useNavigation().state !== 'idle';
  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <h1 className="title-1">Your shortlist</h1>
        <div className="title-rule" aria-hidden="true" />
        <p className="muted">
          Only you see your shortlist. Add it to an event to plan with these businesses; they go on the event as Considering.
        </p>
        {actionData?.error && (
          <p className="notice" role="alert">
            {actionData.error}
          </p>
        )}
        {items.length === 0 ? (
          <p className="section-gap">
            Nothing on your shortlist yet. Tap the + on a business in{' '}
            <Link to="/explore" className="text-link">
              Browse local
            </Link>
            .
          </p>
        ) : (
          <>
            <ul className={styles.list}>
              {items.map((i) => (
                <li key={i.slug} className={styles.item}>
                  {i.photo ? <img src={i.photo} alt="" className={styles.thumb} /> : <span className={styles.thumb} aria-hidden="true" />}
                  <span className={styles.words}>
                    <span className="label">{i.kind}</span>
                    <Link to={`/vendors/${i.slug}`} className={styles.name}>
                      {i.name}
                    </Link>
                  </span>
                  <Form method="post">
                    <input type="hidden" name="intent" value="remove" />
                    <input type="hidden" name="slug" value={i.slug} />
                    <button type="submit" className="text-link" disabled={busy} aria-label={`Remove ${i.name} from your shortlist`}>
                      Remove
                    </button>
                  </Form>
                </li>
              ))}
            </ul>
            <h2 className="label section-gap">Add them to an event</h2>
            {events.length > 0 && (
              <Form method="post" className={styles.choose}>
                <input type="hidden" name="intent" value="to-event" />
                <label htmlFor="eventId" className="field-label">
                  Your event
                </label>
                <select id="eventId" name="eventId" className="input" required>
                  {events.map((e) => (
                    <option key={e.id} value={e.id}>
                      {`${e.name} · ${longDate(e.date, today)} · ${e.town}`}
                    </option>
                  ))}
                </select>
                <button type="submit" className="button button-primary" disabled={busy}>
                  Add to this event
                </button>
              </Form>
            )}
            <p className="section-gap">
              <Link to="/events/new?shortlist=1" className={events.length > 0 ? 'button button-secondary' : 'button button-primary'}>
                Plan a new event with these
              </Link>
            </p>
          </>
        )}
      </main>
    </>
  );
}
