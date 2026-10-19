import { data, Form, redirect, useNavigation, useSearchParams } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { SiteHeader } from '@/components/SiteHeader';
import { refuseTeamMember } from '@/server/bookings.server';
import { isUuid } from '@/lib/ids.mjs';
import { pageMeta } from '@/lib/meta';
import { emailInput } from '@/server/member-input';
import { afterwards, siteUrl } from '@/server/plan-pages.server';
import { TEAM_ROLES, type TeamRole } from '@/lib/team-terms';
import {
  cancelInvite,
  emailNewOwner,
  handOver,
  inviteToTeam,
  removeFromTeam,
  sendInvite,
  setOwnerHidden,
  takeOffLocalites,
  teamFor,
  TeamRefused,
} from '@/server/team.server';
import type { Route } from './+types/team';
import styles from './plan.module.css';

/**
 * Screen V4: the owner's team (E §3; migration 0015). Only the business's current owner,
 * checked in the database on every request; anyone else gets "not found".
 */
export const meta: Route.MetaFunction = ({ loaderData }) => [
  ...pageMeta(loaderData && 'vendor' in loaderData ? `Team · ${loaderData.vendor.name}` : 'Team'),
  { name: 'robots', content: 'noindex' },
];

export async function loader({ params, context }: Route.LoaderArgs) {
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  const team = await teamFor(env, member.userId, params.slug);
  if (!team) {
    await refuseTeamMember(env, member.userId, params.slug, true);
    throw data(null, { status: 404 });
  }
  if ('renamedTo' in team) throw redirect(`/vendors/${team.renamedTo}/team`);
  return team;
}

const ROLES: TeamRole[] = ['manager', 'staff'];

export async function action({ request, params, context }: Route.ActionArgs) {
  const member = context.get(memberContext);
  const { env, ctx } = context.get(cloudflareContext);
  const form = await request.formData();
  const intent = String(form.get('intent') ?? '');
  if (env.OWNER_EDIT_LIMIT && !(await env.OWNER_EDIT_LIMIT.limit({ key: member.userId })).success) {
    return data({ error: 'That’s a lot of changes in a minute. Please wait a moment, then try again.' }, { status: 429 });
  }
  try {
    if (intent === 'invite') {
      const email = emailInput.safeParse(form.get('email') ?? '');
      const role = String(form.get('role') ?? '') as TeamRole;
      if (!email.success) return data({ error: 'Please check the email address.' }, { status: 400 });
      if (!ROLES.includes(role)) return data({ error: 'Choose manager or staff.' }, { status: 400 });
      const invite = await inviteToTeam(
        env,
        { userId: member.userId, email: member.email, name: member.name },
        params.slug,
        email.data,
        role,
      );
      afterwards(ctx, sendInvite(env, siteUrl(env, request), invite, email.data, role, member.name), 'team invitation email');
      return redirect(`/vendors/${params.slug}/team?invited=1`);
    }
    // B6, M18 (D-54): stepping back.
    if (intent === 'hide' || intent === 'show') {
      await setOwnerHidden(env, member.userId, params.slug, intent === 'hide');
      return redirect(`/vendors/${params.slug}/team?${intent === 'hide' ? 'hidden' : 'shown'}=1`);
    }
    if (intent === 'take-off') {
      if (form.get('confirm') !== 'yes') return data({ error: 'Tick the box to confirm.' }, { status: 400 });
      await takeOffLocalites(env, member.userId, params.slug);
      return redirect('/business?off=1');
    }
    const id = String(form.get('id') ?? '');
    if (!isUuid(id)) throw data(null, { status: 400 });
    if (intent === 'cancel') {
      await cancelInvite(env, member.userId, params.slug, id);
      return redirect(`/vendors/${params.slug}/team?cancelled=1`);
    }
    if (intent === 'remove') {
      await removeFromTeam(env, member.userId, params.slug, id);
      return redirect(`/vendors/${params.slug}/team?removed=1`);
    }
    if (intent === 'hand-over') {
      const handed = await handOver(env, member.userId, params.slug, id);
      afterwards(ctx, emailNewOwner(env, handed, member.name, siteUrl(env, request)), 'new owner email');
      return redirect('/business?handed=1');
    }
  } catch (err) {
    if (err instanceof TeamRefused) {
      if (err.message === 'not found') throw data(null, { status: 404 });
      return data({ error: err.message }, { status: 409 });
    }
    throw err;
  }
  throw data(null, { status: 400 });
}

const day = new Intl.DateTimeFormat('en-CA', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Toronto' });
const NOTICES: Record<string, string> = {
  invited: 'Invitation sent. It works for 7 days, only for that email address.',
  cancelled: 'Invitation cancelled.',
  removed: 'Removed from your team. They no longer have access to this business.',
  hidden: 'Your page is hidden. Nobody can find it or message you until you show it again.',
  shown: 'Your page is showing again.',
};

export default function Team({ loaderData, actionData }: Route.ComponentProps) {
  const { vendor, members, invites } = loaderData;
  const others = members.filter((m) => m.role !== 'owner');
  const busy = useNavigation().state !== 'idle';
  const [params] = useSearchParams();
  const notice = Object.keys(NOTICES).find((k) => params.has(k));
  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <h1 className="title-1">Your team at {vendor.name}</h1>
        <div className="title-rule" aria-hidden="true" />
        {actionData?.error && (
          <p className="notice" role="alert">
            {actionData.error}
          </p>
        )}
        {notice && !actionData?.error && (
          <p className="notice" role="status">
            {NOTICES[notice]}
          </p>
        )}
        <p className="muted">
          A <strong>manager</strong> can edit your listing, reply to and block messages, see who marked you as booked, and see Analytics if
          they’re on. Only you, the owner, can change the team. <strong>Staff</strong> can read and reply to customers’ messages.
        </p>

        <section className={styles.section} aria-labelledby="people">
          <h2 id="people" className="label">
            People
          </h2>
          <ul className={styles.list}>
            {members.map((m) => (
              <li key={m.memberId}>
                <span>
                  <strong>{m.name}</strong>
                  {m.you ? ' (you)' : ''} · {m.role === 'owner' ? 'Owner' : m.role === 'manager' ? 'Manager' : 'Staff'}
                </span>
                <span className="muted">Since {day.format(new Date(m.since))}</span>
                {m.role !== 'owner' && (
                  <Form method="post">
                    <input type="hidden" name="intent" value="remove" />
                    <input type="hidden" name="id" value={m.memberId} />
                    <button type="submit" className="text-link" disabled={busy}>
                      Remove {m.name}
                    </button>
                  </Form>
                )}
              </li>
            ))}
          </ul>
        </section>

        {invites.length > 0 && (
          <section className={styles.section} aria-labelledby="waiting">
            <h2 id="waiting" className="label">
              Invited, waiting to accept
            </h2>
            <ul className={styles.list}>
              {invites.map((i) => (
                <li key={i.id}>
                  <span>
                    <strong>{i.email}</strong> · {i.role === 'manager' ? 'Manager' : 'Staff'}
                  </span>
                  <span className="muted">
                    {i.emailStatus === 'failed'
                      ? 'The email didn’t go. Cancel and invite again, or contact supportlocalites@gmail.com.'
                      : `Works until ${day.format(new Date(i.expiresAt))}`}
                  </span>
                  <Form method="post">
                    <input type="hidden" name="intent" value="cancel" />
                    <input type="hidden" name="id" value={i.id} />
                    <button type="submit" className="text-link" disabled={busy}>
                      Cancel invitation
                    </button>
                  </Form>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className={styles.section} aria-labelledby="invite">
          <h2 id="invite" className="label">
            Invite someone
          </h2>
          <Form method="post">
            <input type="hidden" name="intent" value="invite" />
            <div className="field">
              <label htmlFor="email" className="field-label">
                Their email address
              </label>
              <input id="email" name="email" type="email" className="input" autoComplete="off" maxLength={254} required />
            </div>
            <fieldset className="field">
              <legend className="field-label">As</legend>
              {ROLES.map((r) => (
                <label key={r} className={styles.choice}>
                  <input type="radio" name="role" value={r} defaultChecked={r === 'manager'} /> {r === 'manager' ? 'Manager' : 'Staff'}
                  <span className="muted"> · {TEAM_ROLES[r].what}</span>
                </label>
              ))}
            </fieldset>
            <button type="submit" className="button button-primary" disabled={busy}>
              {busy ? 'Sending…' : 'Send invitation'}
            </button>
          </Form>
        </section>

        {/* B6, M18 (D-54): the owner steps back. */}
        <section className={styles.section} aria-labelledby="step-back">
          <h2 id="step-back" className="label">
            Stepping back
          </h2>
          {vendor.ownerHidden ? (
            <Form method="post">
              <p className="muted">You hid your page. Nobody can find it or message you. Messages so far are kept.</p>
              <input type="hidden" name="intent" value="show" />
              <button type="submit" className="button button-secondary" disabled={busy}>
                Show my page again
              </button>
            </Form>
          ) : (
            vendor.status === 'published' && (
              <details>
                <summary className={styles.textButton}>Hide my page for now</summary>
                <p className="muted">
                  Your page won’t show on Localites and nobody can send you new messages until you show it again. Messages so far, your
                  reviews and your team are kept. Events that marked you booked still show your name.
                </p>
                <Form method="post">
                  <input type="hidden" name="intent" value="hide" />
                  <button type="submit" className="button button-secondary" disabled={busy}>
                    Yes, hide my page
                  </button>
                </Form>
              </details>
            )
          )}
          {others.length > 0 ? (
            <details>
              <summary className={styles.textButton}>Hand the business to someone on your team</summary>
              <p className="muted">
                They become the owner and can change the team. You stay on as a manager, and can leave the team afterwards from My
                business. We’ll email them to let them know. Only they can hand it back. Someone whose account is suspended can’t be
                chosen.
              </p>
              <Form method="post">
                <input type="hidden" name="intent" value="hand-over" />
                <div className="field">
                  <label htmlFor="new-owner" className="field-label">
                    New owner
                  </label>
                  <select id="new-owner" name="id" className="input" required>
                    {others.map((m) => (
                      <option key={m.memberId} value={m.memberId}>
                        {m.name} ({m.role === 'manager' ? 'Manager' : 'Staff'})
                      </option>
                    ))}
                  </select>
                </div>
                <button type="submit" className="button button-secondary" disabled={busy}>
                  Yes, hand it over
                </button>
              </Form>
            </details>
          ) : (
            <details>
              <summary className={styles.textButton}>Take my business off Localites</summary>
              <p className="muted">
                There’s nobody else on your team to hand it to. If you take it off, its page goes, you’re no longer its owner, and its
                conversations end (customers can still read them). Events that marked it booked keep its name. This can’t be undone
                here: to come back, email supportlocalites@gmail.com and we’ll add it again. If you’d rather someone else run it, invite
                them first, then hand it over.
              </p>
              <Form method="post">
                <input type="hidden" name="intent" value="take-off" />
                <label className={styles.choice}>
                  <input type="checkbox" name="confirm" value="yes" required /> I understand, take {vendor.name} off Localites
                </label>
                <button type="submit" className="button button-secondary" disabled={busy}>
                  Take it off Localites
                </button>
              </Form>
            </details>
          )}
        </section>
      </main>
    </>
  );
}
