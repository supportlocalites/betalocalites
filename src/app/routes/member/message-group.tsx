import { data, Form, Link, redirect, useNavigation, useSearchParams } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { Inbox, inboxOrder, inboxQuery, inboxView } from '@/components/Inbox';
import { SquarePhoto } from '@/components/SquarePhoto';
import { MainNav, TopBar } from '@/components/TopBar';
import { GROUP_NAME_MAX, readGroupName } from '@/lib/group-name';
import { isUuid, SLUG } from '@/lib/ids.mjs';
import { MESSAGE_LIMITS, NO_PAYMENTS_IN_CONVERSATION } from '@/lib/message-terms';
import { pageMeta } from '@/lib/meta';
import { shortDate, TOO_FAST } from '@/lib/plan-terms';
import { emailAboutMessage, type GroupMember, groupPage, messageAll, myConversations, readBody, renameGroup } from '@/server/messages.server';
import { afterwards, found, refusal, siteUrl, todayIso, tooFast } from '@/server/plan-pages.server';
import type { Route } from './+types/message-group';
import styles from './messages.module.css';

/**
 * One of the person's groups in Messages (D-62, Style A): what they asked, where each business
 * has got to (a new reply, replied, they wrote last, or waiting), rename it, and write to
 * everyone in it again (each gets it privately, as Message all does). Only their own: anyone
 * else's group is "not found".
 */
export const meta: Route.MetaFunction = ({ loaderData }) => [
  ...pageMeta(loaderData ? loaderData.page.group.name : 'Messages'),
  { name: 'robots', content: 'noindex' },
];

export async function loader({ params, context }: Route.LoaderArgs) {
  if (!isUuid(params.id)) throw data(null, { status: 404 });
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  const [page, conversations] = await Promise.all([found(groupPage(env, member.userId, params.id)), myConversations(env, member.userId)]);
  return { page, conversations, today: todayIso() };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  if (!isUuid(params.id)) throw data(null, { status: 404 });
  const member = context.get(memberContext);
  const { env, ctx } = context.get(cloudflareContext);
  const form = await request.formData();
  const intent = String(form.get('intent') ?? '');
  if (await tooFast(env, member.userId)) return data({ error: TOO_FAST, notSent: [] }, { status: 429 });
  const here = `/messages/groups/${params.id}`;
  try {
    if (intent === 'rename') {
      const named = readGroupName(form, true);
      if ('error' in named) return data({ error: named.error, notSent: [] }, { status: 400 });
      await renameGroup(env, member.userId, params.id, named.name);
      return redirect(here);
    }
    if (intent === 'write') {
      const read = readBody(form);
      if ('error' in read) return data({ error: read.error, notSent: [] }, { status: 400 });
      const slugs = [...new Set(form.getAll('slug').map(String))].filter((s) => SLUG.test(s)).slice(0, 50);
      const result = await messageAll(env, member.userId, { groupId: params.id }, slugs, read.body);
      const url = siteUrl(env, request);
      afterwards(
        ctx,
        Promise.all(result.sent.map((w) => emailAboutMessage(env, { side: 'person', userId: member.userId }, w, url))),
        'message email',
      );
      if (result.notSent.length === 0 && result.notGrouped.length === 0) return redirect(`${here}?sent=${result.sent.length}`);
      return {
        error: null,
        notSent: [...result.notSent, ...result.notGrouped.map((name) => ({ name, why: 'Sent, but it isn’t marked as sent with this group.' }))],
      };
    }
    throw data(null, { status: 400 });
  } catch (err) {
    const { error, status } = refusal(err);
    return data({ error, notSent: [] }, { status });
  }
}

const STATE: Record<GroupMember['state'], [string, string]> = {
  replied: ['Replied', 'replied'],
  you: ['You wrote last', 'waiting'],
  waiting: ['Waiting for reply', 'waiting'],
};

export default function MessageGroup({ loaderData: { page, conversations, today }, actionData }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const view = inboxView(params.get('view'));
  const order = inboxOrder(params.get('order'));
  const sent = Number(params.get('sent') ?? 0);
  const busy = useNavigation().state === 'submitting';
  const { group, members, asked } = page;
  const writable = members.filter((m) => !m.note);
  // Replied at all since the group's message (even if you've written since).
  const replied = members.filter((m) => m.state !== 'waiting').length;
  const waiting = members.filter((m) => m.state === 'waiting').length;
  const news = members.filter((m) => m.unread > 0).length;
  return (
    <>
      <TopBar>
        <MainNav unread={conversations.filter((c) => c.unread > 0).length} />
      </TopBar>
      <main className={`page ${styles.split} ${styles.withList}`}>
        <section aria-labelledby="all-messages" className={styles.listPane}>
          <h2 id="all-messages" className={styles.paneTitle}>
            Messages
          </h2>
          <Inbox conversations={conversations} view={view} order={order} currentGroup={group.id} today={today} />
        </section>
        <div className={styles.readPane}>
          <p className={styles.backLink}>
            <Link to={`/messages${inboxQuery(view, order)}`} className="text-link">
              ← Messages
            </Link>
          </p>
          <p className={styles.groupKicker}>Group · only you see it and its name</p>
          <div className={styles.groupTitle}>
            <h1 className={styles.headName}>{group.name}</h1>
            <details className={styles.rename}>
              <summary className={styles.pillButton}>Rename</summary>
              <Form method="post" className={styles.renameForm}>
                <input type="hidden" name="intent" value="rename" />
                <label htmlFor="groupName" className="visually-hidden">
                  The group’s name
                </label>
                <input id="groupName" name="groupName" className="input" defaultValue={group.name} maxLength={GROUP_NAME_MAX} required />
                <button type="submit" className="button button-primary" disabled={busy}>
                  Save
                </button>
              </Form>
            </details>
          </div>
          <p className="muted">
            {`Started ${shortDate(group.createdAt.slice(0, 10), today)} with ${members.length} ${members.length === 1 ? 'business' : 'businesses'}. Each one sees only its own conversation with you, never this group or who else you asked.`}
          </p>
          {sent > 0 && (
            <p className="notice" role="status">
              {`Sent to ${sent === 1 ? '1 business' : `${sent} businesses`}, each in its own conversation. We’ll email you when they reply.`}
            </p>
          )}
          {actionData?.error && (
            <p className="notice" role="alert">
              {actionData.error}
            </p>
          )}
          {actionData?.notSent && actionData.notSent.length > 0 && (
            <div className="notice" role="alert">
              <p>Not sent to:</p>
              <ul>
                {actionData.notSent.map((n) => (
                  <li key={n.name}>{`${n.name}: ${n.why}`}</li>
                ))}
              </ul>
            </div>
          )}
          {asked && (
            <div className={styles.asked}>
              <span className={styles.askedLabel}>What you asked</span>
              <p className={styles.body}>{asked}</p>
            </div>
          )}
          <p className={styles.tally}>
            <span className={`${styles.state} ${styles.replied}`}>{`${replied} replied`}</span>
            {waiting > 0 && <span className={`${styles.state} ${styles.waiting}`}>{`${waiting} waiting`}</span>}
            {news > 0 && <span className={`${styles.state} ${styles.fresh}`}>{`${news} new`}</span>}
          </p>
          {members.length === 0 ? (
            <p className="muted">There are no conversations in this group any more.</p>
          ) : (
            <ul className={styles.track}>
              {members.map((m) => {
                const [label, tone] = m.note ? [m.note, 'waiting'] : m.unread > 0 ? ['New reply', 'fresh'] : STATE[m.state];
                return (
                  <li key={m.conversationId}>
                    <Link to={`/messages/${m.conversationId}${inboxQuery(view, order)}`} className={styles.trackRow}>
                      <SquarePhoto photo={m.photo} alt="" className={styles.trackPhoto} />
                      <span className={styles.trackWords}>
                        <span className={styles.trackTop}>
                          <span className={styles.trackName}>{m.vendorName}</span>
                          <span className={`${styles.state} ${styles[tone]}`}>{label}</span>
                        </span>
                        {m.kind && <span className={styles.trackKind}>{m.kind}</span>}
                        <span className={`${styles.trackSnippet} ${m.unread > 0 ? styles.trackNew : ''}`}>
                          {m.state === 'waiting' ? 'No reply yet.' : m.snippet ? `${m.lastFromMe ? 'You: ' : ''}${m.snippet}` : ''}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          {writable.length > 0 && (
            <Form method="post" className={styles.reply}>
              <input type="hidden" name="intent" value="write" />
              {writable.slice(0, MESSAGE_LIMITS.messageAllMax).map((m) => (
                <input key={m.vendorSlug} type="hidden" name="slug" value={m.vendorSlug} />
              ))}
              <label htmlFor="body" className="field-label">
                {`Write to everyone in “${group.name}”`}
              </label>
              <textarea id="body" name="body" className="input" maxLength={MESSAGE_LIMITS.body} required />
              <p className="field-hint">Each business gets it privately, in its own conversation. To answer just one, open its conversation above.</p>
              <p>
                <button type="submit" className="button button-primary" disabled={busy}>
                  {`Send to ${Math.min(writable.length, MESSAGE_LIMITS.messageAllMax)}`}
                </button>
              </p>
            </Form>
          )}
          <div className={styles.footer}>
            <p className="muted">{NO_PAYMENTS_IN_CONVERSATION}</p>
          </div>
        </div>
      </main>
    </>
  );
}
