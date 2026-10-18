import { Link } from 'react-router';
import { SiteHeader } from '@/components/SiteHeader';
import { shareMeta } from '@/lib/meta';
import type { Route } from './+types/help';
import styles from './info.module.css';

/**
 * Help and contact (product owner, 18 October 2026): the questions people ask, answered from
 * what the site does, and how to reach the team. Nothing here promises more than is built.
 */
export const meta: Route.MetaFunction = ({ matches }) =>
  shareMeta(matches, '/help', 'Help', 'Answers to common questions about Localites, and how to reach us.');

const TEAM = 'supportlocalites@gmail.com';
const mail = (subject: string) => `mailto:${TEAM}?subject=${encodeURIComponent(subject)}`;

export default function Help() {
  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <h1 className="title-1">Help</h1>
        <div className="title-rule" aria-hidden="true" />
        <p>
          Can’t find your answer here? Email us at{' '}
          <a href={mail('A question about Localites')} className="text-link">
            {TEAM}
          </a>
          . A person on our team will get back to you.
        </p>

        <section className={styles.section} aria-labelledby="using">
          <h2 id="using">Using Localites</h2>
          <h3>Does it cost anything?</h3>
          <p>No. Finding businesses, planning your event and inviting guests are free.</p>
          <h3>How do I pay a business?</h3>
          <p>
            Directly, however you agree with them. Localites doesn’t process payments, and nobody should ask you to pay through Localites. If
            someone does, use <strong>Report</strong> in the conversation.
          </p>
          <h3>How do I sign in?</h3>
          <p>
            On <Link to="/join">Sign in or create an account</Link>, type your email address and we email you a 6-digit code. There’s no
            password to remember. If the code doesn’t arrive within a few minutes, check your junk or spam folder, then ask for a new one.
          </p>
          <h3>Who can see my event?</h3>
          <p>
            Only you. When you mark a business as booked, that business sees your name, the date, the town and about how many guests, and
            nothing else. If you choose to share your event when you inquire about a business, our team sees that summary. Your guests see
            only what’s on their invitation.
          </p>
          <h3>A business I want isn’t here</h3>
          <p>
            <Link to="/suggest">Suggest it</Link>, and we’ll look into adding it. If it’s listed but hasn’t joined yet, use{' '}
            <strong>Inquire</strong> on its page and we’ll let you know if it joins.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="problems">
          <h2 id="problems">If something’s wrong</h2>
          <h3>A message, conversation or review breaks the rules</h3>
          <p>
            Use <strong>Report</strong> next to it. Our team looks at every report. In a conversation you can also <strong>block</strong> the
            other side.
          </p>
          <h3>A business’s details are wrong</h3>
          <p>
            Use <strong>Something wrong with this listing?</strong> on the business’s page, or email us with the business’s name.
          </p>
          <h3>Something on the site doesn’t work</h3>
          <p>
            <a href={mail('Something on Localites isn’t working')} className="text-link">
              Email us
            </a>{' '}
            what you were doing and what happened. A screenshot helps.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="account">
          <h2 id="account">Your account and your information</h2>
          <h3>Can I get a copy of my information?</h3>
          <p>
            Yes: <Link to="/account/data">Download your data</Link> on Your account, or email us.
          </p>
          <h3>How do I delete my account?</h3>
          <p>
            On Your account, choose <Link to="/account/delete">Delete your account</Link>. Your events, plans and personal details are deleted
            straight away.
          </p>
          <h3>How do I stop the “How was it?” emails?</h3>
          <p>
            On <Link to="/account">Your account</Link>, untick the box about emails after your events.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="businesses">
          <h2 id="businesses">For businesses</h2>
          <h3>How do I manage my business’s page?</h3>
          <p>
            Open your business’s page and choose <strong>Claim this business</strong>. Claiming is free. Read more on{' '}
            <Link to="/for-businesses">For businesses</Link>.
          </p>
          <h3>I don’t want my business listed</h3>
          <p>
            Use <strong>Ask us to remove it</strong> on your business’s page, or{' '}
            <a href={mail('Please remove my business from Localites')} className="text-link">
              email us
            </a>
            , and we’ll take it down.
          </p>
        </section>
      </main>
    </>
  );
}
