import { Link } from 'react-router';
import { SiteHeader } from '@/components/SiteHeader';
import { pageMeta } from '@/lib/meta';
import type { Route } from './+types/for-businesses';
import styles from './info.module.css';

/**
 * For businesses (Stage 1 "Pages not built yet"): how a local business claims and manages
 * its page, in the words of A §6. Only what is built (D-03, D-33, D-35, D-40, ADR-029, 0015);
 * claiming is free, as each unclaimed page says; nothing about paid plans (not decided).
 */
export const meta: Route.MetaFunction = () =>
  pageMeta('For businesses', 'Claim your business on Localites and hear from people planning events in Orillia and nearby.');

export default function ForBusinesses() {
  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <h1 className="title-1">For local businesses</h1>
        <div className="title-rule" aria-hidden="true" />
        <p>
          People in Orillia, Severn, Oro-Medonte and Ramara use Localites to find local help for their events, then talk to the businesses
          directly. Localites never handles money: you arrange prices, payment and details with your customers yourself.
        </p>

        <section className={styles.section} aria-labelledby="listed">
          <h2 id="listed">Your business may already be here</h2>
          <p>
            Our team adds local businesses using only what each one publishes itself, such as its website and phone number. Until a business
            claims its page, the page says it isn’t on Localites yet. If you’d rather not be listed, email{' '}
            <strong>supportlocalites@gmail.com</strong> and we’ll take it down.
          </p>
          <p>
            Not here yet? Anyone can <Link to="/suggest">suggest a business</Link>; our team looks into each one before adding it.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="claim">
          <h2 id="claim">Claim your page</h2>
          <p>Claiming is free.</p>
          <ol className={styles.steps}>
            <li>Find your business and open its page.</li>
            <li>
              Tap <strong>Claim this business</strong> and sign in. No password: we email you a 6-digit code.
            </li>
            <li>
              Our team checks the claim. If your email address is at your business’s own website, that’s usually enough. Otherwise we contact
              you at the phone number or email your business publishes.
            </li>
            <li>We email you when it’s approved. Only one person can own a business’s page.</li>
          </ol>
        </section>

        <section className={styles.section} aria-labelledby="manage">
          <h2 id="manage">Once it’s yours</h2>
          <ul className={styles.steps}>
            <li>
              <strong>Edit your page</strong> on a screen laid out just like it: your short description, About, website, phone and services,
              with how you show prices. Changes are live at once. To change your business’s name, web address, town, categories or email, email
              us.
            </li>
            <li>
              <strong>Add photos</strong>. Our team looks at each one.
            </li>
            <li>
              <strong>Reply to messages</strong> from people planning events, with photos and PDFs. We email you when a new message arrives.
            </li>
            <li>
              <strong>See who marked you booked</strong>: their name, the date, the town and about how many guests. If one isn’t right, tell us
              with <strong>This isn’t right</strong>.
            </li>
            <li>
              <strong>Reviews</strong> come only from people who marked you booked, after their event. Our team reads each one before it shows,
              and you can reply once, or report one you think breaks the rules.
            </li>
            <li>
              <strong>Bring your team</strong>: the owner can invite managers, who can do everything the owner can except change the team, and
              staff, who read and reply to messages.
            </li>
          </ul>
        </section>

        <section className={styles.section} aria-labelledby="questions">
          <h2 id="questions">Questions</h2>
          <p>
            Email <strong>supportlocalites@gmail.com</strong>.
          </p>
        </section>

        <div className={styles.links}>
          <Link to="/explore" className="button button-primary">
            Find your business
          </Link>
          <Link to="/how-it-works" className="text-link">
            How Localites works for people planning events
          </Link>
        </div>
      </main>
    </>
  );
}
