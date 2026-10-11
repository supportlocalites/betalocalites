import { data, Link, redirect } from 'react-router';
import { cloudflareContext } from '@/app/context';
import { SiteHeader } from '@/components/SiteHeader';
import { VendorPage } from '@/components/VendorPage';
import { hasSessionCookie } from '@/server/auth/session.server';
import { pageMeta } from '@/lib/meta';
import { findRenamed, getVendor } from '@/server/catalog.server';
import type { Route } from './+types/vendor';
import styles from '@/components/VendorPage.module.css';

export const meta: Route.MetaFunction = ({ loaderData }) =>
  loaderData ? pageMeta(loaderData.vendor.name, loaderData.vendor.tagline ?? undefined) : pageMeta('Not found');

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const vendor = await getVendor(env, params.slug);
  if (!vendor) {
    // A renamed listing: its old web address keeps working (shared links, Google).
    const current = await findRenamed(env, params.slug);
    if (current) throw redirect(`/vendors/${current}`, 301);
    throw data(null, { status: 404 });
  }
  return { vendor, slug: params.slug, signedIn: hasSessionCookie(request) };
}

export default function VendorProfile({ loaderData: { vendor, slug, signedIn } }: Route.ComponentProps) {
  return (
    <>
      <SiteHeader />
      <main className="page">
        <VendorPage vendor={vendor}>
          <section aria-labelledby="owner" className={styles.owner}>
            <h2 id="owner" className="label">
              Is this your business?
            </h2>
            {vendor.claimed ? (
              <>
                <p className="muted">
                  This business manages its own listing on Localites. Something wrong? Email supportlocalites@gmail.com.
                </p>
                {/* Only a hint: the edit page itself checks who the owner is. */}
                {signedIn && (
                  <p>
                    Your business?{' '}
                    <Link to={`/vendors/${slug}/edit`} className="text-link">
                      Edit your listing
                    </Link>
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="muted">Claim it to manage this listing yourself. Claiming is free.</p>
                <div className={styles.contact}>
                  <Link to={`/vendors/${slug}/claim`} className="button button-secondary">
                    Claim this business
                  </Link>
                </div>
                <p className="muted">
                  Rather not be listed?{' '}
                  <a href={`mailto:supportlocalites@gmail.com?subject=${encodeURIComponent(`Please remove ${vendor.name}`)}`}>
                    Ask us to remove it
                  </a>
                  .
                </p>
              </>
            )}
          </section>
        </VendorPage>
      </main>
    </>
  );
}
