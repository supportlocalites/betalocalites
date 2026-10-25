import { Link } from 'react-router';
import { SiteHeader } from '@/components/SiteHeader';
import { pageMeta } from '@/lib/meta';
import type { Route } from './+types/goodbye';

/** After someone deletes their account (A4). Says nothing about who: anyone may open it. */
export const meta: Route.MetaFunction = () => [...pageMeta('Your account is deleted'), { name: 'robots', content: 'noindex' }];

export default function Goodbye() {
  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <h1 className="title-1">Your account is deleted</h1>
        <div className="title-rule" aria-hidden="true" />
        <p>Your events, plans, favourites, picks and personal details have been deleted, and you’re signed out.</p>
        <p className="muted">
          You can still browse Localites without an account. If you have any questions, email supportlocalites@gmail.com.
        </p>
        <p>
          <Link to="/explore" className="button button-secondary">
            Browse local
          </Link>
        </p>
      </main>
    </>
  );
}
