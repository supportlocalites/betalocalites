import { type ReactNode, useState } from 'react';
import type { Frame } from '@/lib/photo-frame';
import { PhotoViewer } from './PhotoViewer';
import { SquarePhoto } from './SquarePhoto';
import styles from './VendorPage.module.css';

export type VendorPhoto = {
  id: string;
  url: string;
  smallUrl: string;
  alt: string;
  width: number | null;
  height: number | null;
  frame: Frame | null;
};

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
  /** The page photos in order: the first leads the page. Each has the business's own description. */
  photos?: VendorPhoto[];
  /** The square profile photo beside the name (and in lists), if the business has one. */
  profile?: VendorPhoto | null;
};

/** A photo's shape (width ÷ height); 4:3 when it isn't known. */
const shapeOf = (p: { width: number | null; height: number | null }) => (p.width && p.height ? p.width / p.height : 4 / 3);

/**
 * The band at the top of a business's page (product owner, 13 October 2026): its first photo,
 * always whole, in its own shape, on a soft blurred copy of itself, so wide and tall photos both
 * sit in the same calm band with nothing cut off. children: what sits over it (the edit page's
 * Photos button).
 */
export function PhotoHero({ photo, onOpen, children }: { photo: VendorPhoto | undefined; onOpen?: () => void; children?: ReactNode }) {
  if (!photo) {
    return (
      <div className={`${styles.hero} ${styles.heroEmpty}`} aria-hidden={children ? undefined : true}>
        {children}
      </div>
    );
  }
  const picture = (
    <>
      <img src={photo.smallUrl} alt="" aria-hidden="true" className={styles.heroBackdrop} />
      <img
        src={photo.url}
        alt={photo.alt}
        width={photo.width ?? undefined}
        height={photo.height ?? undefined}
        className={styles.heroPhoto}
        fetchPriority="high"
      />
    </>
  );
  return (
    <div className={styles.hero}>
      {onOpen ? (
        // A link without the page's script (the photo opens on its own); the viewer with it.
        <a
          href={photo.url}
          className={styles.heroOpen}
          onClick={(e) => {
            e.preventDefault();
            onOpen();
          }}
        >
          {picture}
        </a>
      ) : (
        picture
      )}
      {children}
    </div>
  );
}

/** The business's name, with its square profile photo beside it when it has one. */
export function BusinessName({
  vendor,
  profile,
  overPhoto,
  children,
}: {
  vendor: Pick<VendorView, 'name' | 'categories' | 'town'>;
  profile: ReactNode;
  overPhoto: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={`${styles.identity} ${profile && overPhoto ? styles.identityOver : ''}`}>
      {profile}
      <div className={styles.nameBlock}>
        <span className="label">{[...vendor.categories, vendor.town].filter(Boolean).join(' · ')}</span>
        <h1 className="title-1">{vendor.name}</h1>
        <div className="title-rule" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}

/**
 * A business's page (screen P4) exactly as visitors see it. The public page, the owner's
 * "View as a visitor" preview and the edit page's layout all come from here, so what an
 * owner sees while editing is what visitors get (D-34). On computers, how to reach the
 * business sits in a column beside the rest.
 */
export function VendorPage({ vendor, children }: { vendor: VendorView; children?: ReactNode }) {
  const photos = vendor.photos ?? [];
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className={styles.page}>
      {photos.length > 0 && <PhotoHero photo={photos[0]} onOpen={() => setOpen(0)} />}
      <div className={styles.body}>
        <div className={styles.details}>
          <BusinessName
            vendor={vendor}
            overPhoto={photos.length > 0}
            profile={
              vendor.profile ? (
                <SquarePhoto photo={vendor.profile} alt={vendor.profile.alt} size="profile" className={styles.profile} />
              ) : null
            }
          />
          {vendor.tagline && <p className={styles.tagline}>{vendor.tagline}</p>}
          {vendor.description && <p className={`muted ${styles.about}`}>{vendor.description}</p>}

          {photos.length > 1 && (
            <section aria-labelledby="photos">
              <h2 id="photos" className="label">
                Photos ({photos.length})
              </h2>
              <PhotoRows photos={photos} onOpen={setOpen} />
            </section>
          )}

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
        </div>

        <aside className={styles.side}>
          <section aria-labelledby="contact">
            <h2 id="contact" className="label">
              Contact
            </h2>
            {!vendor.claimed && (
              <p className="muted">
                Not on Localites yet. These are the business&rsquo;s own public details; arrange everything directly with them.
              </p>
            )}
            {!vendor.websiteUrl && !vendor.publicPhone && vendor.claimed && (
              <p className="muted">This business hasn&rsquo;t shared a website or phone number yet.</p>
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
        </aside>
      </div>
      {open !== null && <PhotoViewer photos={photos} start={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/**
 * Every photo whole, in its own shape, in tidy rows of even height (like Google Photos and
 * Flickr): each photo's share of a row is its width ÷ height, so nothing is ever cut.
 */
export function PhotoRows({ photos, onOpen }: { photos: VendorPhoto[]; onOpen: (index: number) => void }) {
  return (
    <ul className={styles.rows}>
      {photos.map((p, i) => (
        <li key={p.id} className={styles.rowItem} style={{ '--shape': shapeOf(p) } as React.CSSProperties}>
          <a
            href={p.url}
            className={styles.rowLink}
            onClick={(e) => {
              e.preventDefault();
              onOpen(i);
            }}
          >
            <img src={p.smallUrl} alt={p.alt} loading="lazy" className={styles.rowPhoto} />
          </a>
        </li>
      ))}
    </ul>
  );
}
