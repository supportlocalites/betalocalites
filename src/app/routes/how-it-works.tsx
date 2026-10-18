import { Link } from 'react-router';
import { SiteHeader } from '@/components/SiteHeader';
import { shareMeta } from '@/lib/meta';
import type { Route } from './+types/how-it-works';
import styles from './info.module.css';

/**
 * How it works (P-screens, Stage 1 "Pages not built yet"): what Localites does for someone
 * planning an event, in the words of A §6. Only what is built; nothing about payments except
 * that they never go through Localites (D-16, D-24).
 */
export const meta: Route.MetaFunction = ({ matches }) =>
  shareMeta(matches, '/how-it-works', 'How it works', 'Find local businesses for your event in Orillia and nearby, and talk to them directly.');

export default function HowItWorks() {
  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <h1 className="title-1">How it works</h1>
        <div className="title-rule" aria-hidden="true" />
        <p>
          Localites connects you with local businesses for your event in Orillia, Severn, Oro-Medonte and Ramara. You find them, talk to them
          directly, and arrange everything with them yourself.
        </p>

        <section className={styles.section} aria-labelledby="find">
          <h2 id="find">1. Find local businesses</h2>
          <p>
            Browse by category or search by name, kind of business or town. Each business has its own page with what it offers, its website
            and phone number, and reviews from people who booked it. No account needed.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="talk">
          <h2 id="talk">2. Talk to them directly</h2>
          <p>
            Businesses that manage their own page on Localites can be messaged here, and you can send a photo or a PDF with a message. For a
            business that hasn’t joined yet, <strong>Inquire</strong> tells our team you’re interested, so we can invite the business to join;
            we email you if it does. You can always use the business’s own website or phone number too.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="plan">
          <h2 id="plan">3. Plan your event</h2>
          <p>
            Make an event with a date and a town (its name and details stay private). <strong>Add to event</strong> keeps the businesses you’re
            considering together. When you’ve agreed with one, <strong>Mark as booked</strong> so you can keep track. The business then sees
            your name, the date, the town and about how many guests, and nothing else.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="guests">
          <h2 id="guests">4. Invite your guests</h2>
          <p>
            Add your guests and send each one their own invitation link from your phone, by text, WhatsApp, email or however you like. Guests
            reply yes, maybe or no without making an account, and you see who has replied.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="review">
          <h2 id="review">5. Say how it went</h2>
          <p>
            The morning after your event, we ask how each business you booked did. Our team reads every review before it shows on the
            business’s page, and the business can reply once.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="money">
          <h2 id="money">Arranging details and paying</h2>
          <p>
            Localites doesn’t handle any money. Prices, payment and the details of what you’ve agreed are between you and the business, arranged
            directly with them.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="account">
          <h2 id="account">Your account</h2>
          <p>
            Signing in needs no password: type your email and we send you a 6-digit code. You can delete your account at any time from{' '}
            <strong>Your account</strong>.
          </p>
        </section>

        <div className={styles.links}>
          <Link to="/explore" className="button button-primary">
            Browse local
          </Link>
          <Link to="/events/new" className="button button-secondary">
            Plan an event
          </Link>
          <Link to="/for-businesses" className="text-link">
            Own a local business?
          </Link>
        </div>
      </main>
    </>
  );
}
