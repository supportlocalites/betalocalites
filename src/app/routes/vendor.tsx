import { data, Link, redirect } from 'react-router';
import { cloudflareContext } from '@/app/context';
import { SiteHeader } from '@/components/SiteHeader';
import { pageMeta } from '@/lib/meta';
import { findRenamed, getVendor } from '@/server/catalog.server';
import type { Route } from './+types/vendor';
import styles from './vendor.module.css';

export const meta: Route.MetaFunction = ({ loaderData }) =>
  loaderData ? pageMeta(loaderData.vendor.name, loaderData.vendor.tagline ?? undefined) : pageMeta('Not found');

export async function loader({ params, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const vendor = await getVendor(env, params.slug);
  if (!vendor) {
    // A renamed listing: its old web address keeps working (shared links, Google).
    const current = await findRenamed(env, params.slug);
    if (current) throw redirect(`/vendors/${current}`, 301);
    throw data(null, { status: 404 });
  }
  return { vendor, slug: params.slug };
}

export default function VendorProfile({ loaderData: { vendor, slug } }: Route.ComponentProps) {
  return (
    <>
      <SiteHeader />
      <main className="page">
        <div className={styles.layout}>
          <div className={styles.photo} aria-hidden="true" />
          <div className={styles.details}>
            <span className="label">
              {vendor.categories.join(' · ')} · {vendor.town}
            </span>
            <h1 className="title-1">{vendor.name}</h1>
            <div className="title-rule" aria-hidden="true" />
            {vendor.tagline && <p>{vendor.tagline}</p>}
            {vendor.description && <p className="muted">{vendor.description}</p>}

            {vendor.services.length > 0 && (
              <section aria-labelledby="services">
                <h2 id="services" className="label">
                  Services
                </h2>
                <ul className={styles.services}>
                  {vendor.services.map((s) => (
                    <li key={s.name} className={styles.service}>
                      <span>{s.name}</span>
                      {s.price && <span className="muted">{s.price}</span>}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section aria-labelledby="contact">
              <h2 id="contact" className="label">
                Contact
              </h2>
              {!vendor.claimed && (
                <p className="muted">
                  Not on Localites yet. These are the business&rsquo;s own public details; arrange everything directly
                  with them.
                </p>
              )}
              <div className={styles.contact}>
                {vendor.websiteUrl && (
                  <a href={vendor.websiteUrl} className="button button-secondary" rel="noopener nofollow" target="_blank">
                    Visit website
                  </a>
                )}
                {vendor.publicPhone && (
                  <a href={`tel:${vendor.publicPhone.replace(/[^0-9+]/g, '')}`} className="button button-secondary">
                    Call {vendor.publicPhone}
                  </a>
                )}
              </div>
            </section>

            <section aria-labelledby="owner" className={styles.owner}>
              <h2 id="owner" className="label">
                Is this your business?
              </h2>
              {vendor.claimed ? (
                <p className="muted">
                  This business manages its own listing on Localites. Something wrong? Email supportlocalites@gmail.com.
                </p>
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
          </div>
        </div>
      </main>
    </>
  );
}
