import { Form, Link, useNavigation } from 'react-router';
import { SiteHeader } from '@/components/SiteHeader';
import { GROUP_NAME_MAX } from '@/lib/group-name';
import { MESSAGE_LIMITS, NO_PAYMENTS_IN_CONVERSATION, SHARE_CAREFULLY } from '@/lib/message-terms';

type Result = { sentTo: string[]; notSent: { name: string; why: string }[]; groupId: string | null; notGrouped: string[] } | null;

/**
 * "Message all" (D-58, D-57 step 3): choose the businesses, write once, and each gets it in its
 * own conversation. Used from an event's Considering list and from the shortlist bar.
 */
export function MessageAll({
  back,
  title,
  intro,
  none,
  businesses,
  actionData,
}: {
  back: { to: string; label: string; again: string };
  title: string;
  intro: React.ReactNode;
  none: string;
  businesses: { slug: string; name: string }[];
  actionData: { error: string | null; result: Result } | undefined;
}) {
  const busy = useNavigation().state !== 'idle';
  const result = actionData?.result;
  const many = businesses.length > MESSAGE_LIMITS.messageAllMax;
  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <p>
          <Link to={back.to} className="text-link">
            ← {back.label}
          </Link>
        </p>
        <h1 className="title-1">{title}</h1>
        <div className="title-rule" aria-hidden="true" />
        {result ? (
          <>
            {result.sentTo.length > 0 && (
              <p className="notice" role="status">
                {result.groupId && result.notGrouped.length === 0
                  ? `Sent to ${result.sentTo.join(', ')}. Each is its own conversation, kept together as a group in your Messages; we’ll email you when they reply.`
                  : `Sent to ${result.sentTo.join(', ')}. Each is its own conversation in your Messages; we’ll email you when they reply.`}
              </p>
            )}
            {result.notGrouped.length > 0 && (
              <p className="notice" role="status">
                {`${result.notGrouped.join(', ')} got your message, but ${result.notGrouped.length === 1 ? 'isn’t' : 'aren’t'} in the group. You’ll find ${result.notGrouped.length === 1 ? 'it' : 'them'} in Messages.`}
              </p>
            )}
            {result.notSent.length > 0 && (
              <div className="notice" role="alert">
                <p>Not sent to:</p>
                <ul>
                  {result.notSent.map((n) => (
                    <li key={n.name}>{`${n.name}: ${n.why}`}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="section-gap">
              <Link to={result.groupId ? `/messages/groups/${result.groupId}` : '/messages'} className="button button-primary">
                {result.groupId ? 'Open the group in Messages' : 'See your messages'}
              </Link>{' '}
              <Link to={back.to} className="button button-secondary">
                {back.again}
              </Link>
            </p>
          </>
        ) : businesses.length === 0 ? (
          <>
            <p>{none}</p>
            <p>
              <Link to={back.to} className="text-link">
                {back.again}
              </Link>
            </p>
          </>
        ) : (
          <>
            {intro}
            {actionData?.error && (
              <p className="notice" role="alert">
                {actionData.error}
              </p>
            )}
            <Form method="post">
              <div className="field">
                <label htmlFor="groupName" className="field-label">
                  Name this group
                </label>
                <input id="groupName" name="groupName" className="input" maxLength={GROUP_NAME_MAX} placeholder="For example, Dinosaur party" />
                <p className="field-hint">
                  Only you see it, and you can change it any time. Left blank, it’s called by today’s date. Messages keeps these
                  conversations together under this name.
                </p>
              </div>
              <fieldset className="field">
                <legend className="field-label">
                  {many ? `Send to (up to ${MESSAGE_LIMITS.messageAllMax} at a time)` : 'Send to'}
                </legend>
                {businesses.map((b, i) => (
                  <label key={b.slug} className="field-hint">
                    <input type="checkbox" name="slug" value={b.slug} defaultChecked={i < MESSAGE_LIMITS.messageAllMax} /> {b.name}
                  </label>
                ))}
              </fieldset>
              <div className="field">
                <label htmlFor="body" className="field-label">
                  Your message
                </label>
                <textarea id="body" name="body" className="input" maxLength={MESSAGE_LIMITS.body} required />
              </div>
              <p className="muted">{NO_PAYMENTS_IN_CONVERSATION}</p>
              <p className="muted">{SHARE_CAREFULLY}</p>
              <p>
                <button type="submit" className="button button-primary" disabled={busy}>
                  Send to each
                </button>
              </p>
            </Form>
          </>
        )}
      </main>
    </>
  );
}
