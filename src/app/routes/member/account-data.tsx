import { Link } from 'react-router';
import { SiteHeader } from '@/components/SiteHeader';
import { pageMeta } from '@/lib/meta';
import type { Route } from './+types/account-data';

/**
 * Download my data (migration 0043; privacy policy §11): a copy of everything Localites holds
 * about the signed-in person, as a file. Open to a suspended person too (memberGate). Only ever
 * the signed-in person's own: no id comes from the page.
 */
export const meta: Route.MetaFunction = () => [...pageMeta('Download your data'), { name: 'robots', content: 'noindex' }];

export default function AccountData() {
  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <h1 className="title-1">Download your data</h1>
        <div className="title-rule" aria-hidden="true" />
        <p>
          You can have a copy of your information on Localites, including your account and details, your events, plans and guests, favourites
          and shortlist, conversations, reviews, inquiries, suggestions, reports, business teams and claims, what you did for a business
          you’re or were on the team of (messages you wrote for it, changes you saved to its page, replies to reviews, photos and notes),
          and the latest record of how you’ve used Localites.
        </p>
        <p>
          <a href="/account/data/download?readable" className="button button-primary" download>
            Download a readable copy
          </a>
        </p>
        <p className="muted">
          A page that opens in any web browser, with headings and tables, that you can read or print. Very long lists show 500 of their entries (your most recent activity and searches).
        </p>
        <p>
          <a href="/account/data/download" className="button button-secondary" download>
            Download the data file
          </a>
        </p>
        <p className="muted">
          Everything, in a standard format (JSON) other apps can read. Files sent in conversations are listed by name; download those from
          the conversation itself. For anything else we hold, email supportlocalites@gmail.com.
        </p>
        <p>
          <Link to="/account" className="text-link">
            Back to your account
          </Link>
        </p>
      </main>
    </>
  );
}
