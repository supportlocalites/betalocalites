import type { ReactNode } from 'react';
import styles from './VendorPage.module.css';

export type VendorPhoto = { id: string; url: string; smallUrl: string; alt: string; width: number | null; height: number | null };

export type VendorView = {
  name: string;
  tagline: string | null;
  description: string | null;
  town: string;
  categories: string[];
  websiteUrl: string | null;
  publicPhone: string | null;
  claimed: boolean;
  services: { name: string; description: string | null; price: string | null }[];
  /** In order: the first is the main photo. Each has the business's own description. */
  photos?: VendorPhoto[];
};

/**
 * A business's page (screen P4) exactly as visitors see it. The public page, the owner's
 * "View as a visitor" preview and the edit page's layout all come from here, so what an
 * owner sees while editing is what visitors get (D-34).
 */
export function VendorPage({ vendor, children }: { vendor: VendorView; children?: ReactNode }) {
  const [main, ...more] = vendor.photos ?? [];
  return (
    <div className={styles.layout}>
      {main ? (
        <a href={main.url} className={styles.photo} target="_blank" rel="noopener">
          <img
            src={main.url}
            alt={main.alt}
            width={main.width ?? undefined}
            height={main.height ?? undefined}
            className={styles.photoImage}
          />
        </a>
      ) : (
        <div className={styles.photo} aria-hidden="true" />
      )}
      <div className={styles.details}>
        <span className="label">{[...vendor.categories, vendor.town].filter(Boolean).join(' · ')}</span>
        <h1 className="title-1">{vendor.name}</h1>
        <div className="title-rule" aria-hidden="true" />
        {vendor.tagline && <p>{vendor.tagline}</p>}
        {vendor.description && <p className={`muted ${styles.about}`}>{vendor.description}</p>}

        {vendor.services.length > 0 && (
          <section aria-labelledby="services">
            <h2 id="services" className="label">
              Services
            </h2>
            <ul className={styles.services}>
              {vendor.services.map((s, i) => (
                <li key={i} className={styles.service}>
                  <span className={styles.serviceName}>
                    <span>{s.name}</span>
                    {s.description && <span className={`muted ${styles.serviceDetails}`}>{s.description}</span>}
                  </span>
                  {s.price && <span className="muted">{s.price}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {more.length > 0 && (
          <section aria-labelledby="photos">
            <h2 id="photos" className="label">
              Photos
            </h2>
            <ul className={styles.gallery}>
              {more.map((p) => (
                <li key={p.id}>
                  <a href={p.url} target="_blank" rel="noopener" className={styles.galleryLink}>
                    <img src={p.smallUrl} alt={p.alt} loading="lazy" className={styles.photoImage} />
                  </a>
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
              Not on Localites yet. These are the business&rsquo;s own public details; arrange everything directly with them.
            </p>
          )}
          <div className={styles.contact}>
            {vendor.websiteUrl && (
              <a
                href={vendor.websiteUrl}
                className="button button-secondary"
                rel="noopener nofollow"
                target="_blank"
                data-activity="website_tap"
              >
                Visit website
              </a>
            )}
            {vendor.publicPhone && (
              <a href={`tel:${vendor.publicPhone.replace(/[^0-9+]/g, '')}`} className="button button-secondary" data-activity="phone_tap">
                Call {vendor.publicPhone}
              </a>
            )}
          </div>
        </section>
        {children}
      </div>
    </div>
  );
}
