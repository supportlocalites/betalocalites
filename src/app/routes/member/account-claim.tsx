import { useState } from 'react';
import { Form, Link, useSearchParams } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { SiteHeader } from '@/components/SiteHeader';
import { cleanText } from '@/lib/clean-text';
import { fuzzyMatch } from '@/lib/fuzzy';
import { pageMeta } from '@/lib/meta';
import { claimableBusinesses } from '@/server/claims.server';
import type { Route } from './+types/account-claim';
import styles from './account.module.css';

/**
 * Claim a business, from Edit profile (D-63): search the listed businesses nobody runs yet and
 * open yours to claim it. The claim itself is the one on every business's page (D-29, D-33):
 * the team phones or emails the business to confirm before anything changes.
 */
export const meta: Route.MetaFunction = () => [...pageMeta('Claim a business'), { name: 'robots', content: 'noindex' }];

export async function loader({ context }: Route.LoaderArgs) {
  const member = context.get(memberContext);
  return { businesses: await claimableBusinesses(context.get(cloudflareContext).env, member.userId) };
}

export default function AccountClaim({ loaderData: { businesses } }: Route.ComponentProps) {
  const [params] = useSearchParams();
  // Typing filters at once; without scripts, the search box sends ?q= and the page filters the same way.
  const [q, setQ] = useState(cleanText(params.get('q') ?? '').slice(0, 100));
  const shown = q.trim() ? businesses.filter((b) => fuzzyMatch(q, `${b.name} ${b.kind ?? ''} ${b.town ?? ''}`)) : businesses;
  return (
    <>
      <SiteHeader />
      <main className={`page ${styles.narrow}`}>
        <p>
          <Link to="/account?tab=businesses" className="text-link">
            ← Edit profile
          </Link>
        </p>
        <div className={styles.panel}>
          <h1 className={styles.panelTitle}>Claim a business</h1>
          <p className={styles.panelHint}>Businesses on Localites that nobody has claimed yet. Find yours and tell us it’s yours.</p>
          <Form method="get" role="search" className={styles.search}>
            <label htmlFor="q" className="visually-hidden">
              Search businesses
            </label>
            <input
              id="q"
              name="q"
              type="search"
              className="input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name, kind of business or town"
              autoComplete="off"
            />
          </Form>
          {shown.length === 0 ? (
            <p className={styles.panelHint}>
              Not here? <Link to="/account/add-business">Add your business</Link> instead.
            </p>
          ) : (
            <ul className={styles.rows}>
              {shown.slice(0, 100).map((b) => (
                <li key={b.slug} className={styles.row}>
                  <span className={styles.rowWords}>
                    <span className={styles.rowName}>{b.name}</span>
                    <span className={styles.rowMeta}>{[b.kind, b.town].filter(Boolean).join(' · ')}</span>
                  </span>
                  {b.mine ? (
                    <span className={`${styles.pill} ${styles.pillWait}`}>Your claim is with our team</span>
                  ) : (
                    <Link to={`/vendors/${b.slug}/claim`} className={styles.pillButton} aria-label={`Claim ${b.name}`}>
                      Claim
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
          {shown.length > 100 && <p className={styles.panelHint}>Showing the first 100. Type more of the name to narrow it down.</p>}
          <p className={styles.panelHint}>Our team will phone or email the business at its published number or address to check it’s you.</p>
        </div>
      </main>
    </>
  );
}
