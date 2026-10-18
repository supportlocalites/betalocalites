import { Link } from 'react-router';
import { SiteHeader } from '@/components/SiteHeader';
import { pageMeta } from '@/lib/meta';
import type { Route } from './+types/suspended';

/**
 * Where a suspended person is sent from any signed-in page (migration 0042). Says nothing about
 * who: anyone may open it. Their own data and deleting the account stay open to them.
 */
export const meta: Route.MetaFunction = () => [...pageMeta('Your account is suspended'), { name: 'robots', content: 'noindex' }];

export default function Suspended() {
  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <h1 className="title-1">Your account is suspended</h1>
        <div className="title-rule" aria-hidden="true" />
        <p>The Localites team has suspended this account, so its pages are closed for now.</p>
        <p>
          If you think this is a mistake, or want to know why, email{' '}
          <a href="mailto:supportlocalites@gmail.com" className="text-link">
            supportlocalites@gmail.com
          </a>
          .
        </p>
        <p className="muted">You can still download a copy of your data, or delete your account.</p>
        <p>
          <Link to="/account/data" className="button button-secondary">
            Download my data
          </Link>{' '}
          <Link to="/account/delete" className="button button-secondary">
            Delete my account
          </Link>
        </p>
        <p>
          <Link to="/explore" className="text-link">
            Browse local
          </Link>
        </p>
      </main>
    </>
  );
}
