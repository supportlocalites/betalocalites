import { data, Form, Link, redirect, useNavigation } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { SiteHeader } from '@/components/SiteHeader';
import { isUuid } from '@/lib/ids.mjs';
import { pageMeta } from '@/lib/meta';
import { longDate, NO_PAYMENTS_PERSON, TOO_FAST } from '@/lib/plan-terms';
import { CHANGE_STEPS, changePlan, type PlanChange, PLAN_CHANGES, planChangeTarget } from '@/server/events.server';
import { sendBookingNotice } from '@/server/plan-emails.server';
import { afterwards, found, refusal, siteUrl, todayIso, tooFast } from '@/server/plan-pages.server';
import type { Route } from './+types/plan-change';
import styles from './plan.module.css';

/**
 * Screen C5 and the other changes to one business on a plan: mark as booked, un-mark,
 * remove, put back (B §4, ADR-017). The page asks first (it works without JavaScript);
 * the change is the form's POST. Only a business marked booked, or no longer marked, is
 * told, and only when it's on Localites (D-40).
 */
export const meta: Route.MetaFunction = ({ loaderData }) => [
  ...pageMeta(loaderData ? WORDS[loaderData.change].title(loaderData.target.vendorName) : 'Your plan'),
  { name: 'robots', content: 'noindex' },
];

const isChange = (s: string): s is PlanChange => (PLAN_CHANGES as readonly string[]).includes(s);

/** The address's ids and change, checked first: anything else is "not found". */
function checked(params: { id: string; rowId: string; change: string }) {
  if (!isUuid(params.id) || !isUuid(params.rowId) || !isChange(params.change)) throw data(null, { status: 404 });
  return { id: params.id, rowId: params.rowId, change: params.change };
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const { id, rowId, change } = checked(params);
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  const target = await found(planChangeTarget(env, member.userId, id, rowId));
  // A change that doesn't fit where the business is now goes back to the plan, which shows the truth.
  if (target.cancelled || !CHANGE_STEPS[change].from.includes(target.status)) throw redirect(`/events/${id}`);
  return { id, change, target, today: todayIso() };
}

/** Where each change returns to on the plan, and the notice it shows there. */
const NOTICE: Record<PlanChange, string> = { book: 'booked', unbook: 'unbooked', remove: 'removed', readd: 'back' };

export async function action({ request, params, context }: Route.ActionArgs) {
  const { id, rowId, change } = checked(params);
  const member = context.get(memberContext);
  const { env, ctx } = context.get(cloudflareContext);
  if (await tooFast(env, member.userId)) return data({ error: TOO_FAST }, { status: 429 });
  try {
    const { notice } = await changePlan(env, member.userId, id, rowId, change);
    if (notice) afterwards(ctx, sendBookingNotice(env, siteUrl(env, request), notice), 'booking email');
  } catch (err) {
    const { error, status } = refusal(err);
    return data({ error }, { status });
  }
  return redirect(`/events/${id}?${NOTICE[change]}=${rowId}`);
}

type Target = { vendorName: string; claimed: boolean; status: string; date: string };

/** Each change's question, its explanation, and its two buttons. */
const WORDS: Record<PlanChange, { title: (b: string) => string; go: string; busy: string; stay: string }> = {
  book: { title: (b) => `Mark ${b} as booked?`, go: 'Mark as booked', busy: 'Marking…', stay: 'Not yet' },
  unbook: { title: (b) => `Un-mark ${b} as booked?`, go: 'Un-mark', busy: 'Saving…', stay: 'Keep as booked' },
  remove: { title: (b) => `Remove ${b} from this event?`, go: 'Remove', busy: 'Removing…', stay: 'Keep' },
  readd: { title: (b) => `Put ${b} back on your plan?`, go: 'Put back', busy: 'Saving…', stay: 'Go back' },
};

function Explanation({ change, target, today }: { change: PlanChange; target: Target; today: string }) {
  const b = target.vendorName;
  if (change === 'book') {
    return (
      <>
        <p>This is your own record, to help you keep track.</p>
        <p>
          {target.claimed ? (
            <>
              <strong>We’ll let {b} know you’ve marked them as booked</strong> for {longDate(target.date, today)}.
            </>
          ) : (
            `${b} isn’t on Localites yet, so we can’t let them know. It’s still your own record.`
          )}
        </p>
        {/* Every path to sharing passes here, so this is where the person is told what is shared (D-40). */}
        <p>
          {target.claimed
            ? `${b} will see your name, the date, the town and about how many guests. Never your event’s name, where it is, the ages, your budget or your notes.`
            : `If ${b} joins Localites later, they’ll see that you marked them booked: your name, the date, the town and about how many guests. Never your event’s name, where it is, the ages, your budget or your notes.`}
        </p>
        <p className="muted">{NO_PAYMENTS_PERSON}</p>
      </>
    );
  }
  if (change === 'unbook') return <p>They go back to Considering.{target.claimed ? ` We’ll let ${b} know.` : ''}</p>;
  if (change === 'remove') {
    return (
      <p>
        {target.status === 'booked'
          ? target.claimed
            ? 'We’ll let them know they’re no longer marked as booked.'
            : 'They aren’t on Localites yet, so they aren’t told.'
          : 'They aren’t told.'}
      </p>
    );
  }
  return <p>They go back to Considering. They aren’t told.</p>;
}

export default function ChangePlan({ loaderData, actionData }: Route.ComponentProps) {
  const { id, change, target, today } = loaderData;
  const busy = useNavigation().state !== 'idle';
  const words = WORDS[change];
  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <p className="label">{target.eventName}</p>
        <h1 className="title-1">{words.title(target.vendorName)}</h1>
        <div className="title-rule" aria-hidden="true" />
        {actionData?.error && (
          <p className="notice" role="alert">
            {actionData.error}
          </p>
        )}
        <Explanation change={change} target={target} today={today} />
        <Form method="post" className={styles.actions}>
          <button type="submit" className="button button-primary" disabled={busy}>
            {busy ? words.busy : words.go}
          </button>
          <Link to={`/events/${id}`} className="button button-secondary">
            {words.stay}
          </Link>
        </Form>
      </main>
    </>
  );
}
