import { type ReactNode, useState } from 'react';
import type { Frame } from '@/lib/photo-frame';
import { Cost, COST_WORDS } from './BrowseCard';
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
  services: { name: string; description: string | null }[];
  /** $ to $$$, set by our team (D-56); none until it's set. */
  cost?: number | null;
  /** The page photos in order: the first leads the page. Each has the business's own description. */
  photos?: VendorPhoto[];
  /** The square profile photo beside the name (and in lists), if the business has one. */
  profile?: VendorPhoto | null;
};

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

/** The three words under the name (D-57): the cost the team set, the rating, and whether the business is on Localites. */
export type VendorRating = { count: number; average: number | null };

function Summary({ vendor, rating }: { vendor: VendorView; rating?: VendorRating }) {
  const words =
    rating && rating.average !== null
      ? null
      : rating && rating.count > 0
        ? `${rating.count} ${rating.count === 1 ? 'review' : 'reviews'}`
        : null;
  if (!vendor.cost && !rating?.count && !vendor.claimed) return null;
  return (
    <p className={styles.summary}>
      {vendor.cost ? (
        <span>
          <Cost level={vendor.cost} /> <span aria-hidden="true">{COST_WORDS[vendor.cost]}</span>
        </span>
      ) : null}
      {rating && rating.average !== null && (
        <span className={styles.rated}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={styles.star}>
            <path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7L12 17.3 5.8 20.9l1.6-7L2 9.2l7.1-.6z" />
          </svg>
          <span>
            <strong>{rating.average.toFixed(1)}</strong> from {rating.count} reviews
          </span>
        </span>
      )}
      {words && <span>{words}</span>}
      {vendor.claimed && <span>Members of the Localites community</span>}
    </p>
  );
}

/**
 * The photos at the top (D-58): the first large, the next two beside it, and "See all" to open
 * them one at a time. Each stays whole on a soft copy of itself (D-45). Phones: the first only,
 * with how many there are.
 */
function PhotoMosaic({ photos, onOpen }: { photos: VendorPhoto[]; onOpen: (index: number) => void }) {
  const tile = (p: VendorPhoto, i: number, className: string) => (
    <a
      key={p.id}
      href={p.url}
      className={`${styles.tile} ${className}`}
      onClick={(e) => {
        e.preventDefault();
        onOpen(i);
      }}
    >
      <img src={p.smallUrl} alt="" aria-hidden="true" className={styles.heroBackdrop} />
      <img
        src={i === 0 ? p.url : p.smallUrl}
        alt={p.alt}
        width={p.width ?? undefined}
        height={p.height ?? undefined}
        className={styles.heroPhoto}
        fetchPriority={i === 0 ? 'high' : undefined}
        loading={i === 0 ? undefined : 'lazy'}
      />
    </a>
  );
  const side = photos.slice(1, 3);
  return (
    <section aria-label="Photos" className={`${styles.mosaic} ${side.length ? styles.mosaicSide : ''}`}>
      {tile(photos[0]!, 0, styles.tileMain!)}
      {side.length > 0 && <div className={styles.sideTiles}>{side.map((p, i) => tile(p, i + 1, styles.tileSide!))}</div>}
      {photos.length > 1 && (
        <button type="button" className={styles.seeAll} onClick={() => onOpen(0)} aria-label={`See all ${photos.length} photos`}>
          <span className={styles.seeAllWide}>See all {photos.length} photos</span>
          <span className={styles.seeAllPhone} aria-hidden="true">
            1 of {photos.length}
          </span>
        </button>
      )}
    </section>
  );
}

/**
 * A business's page (screen P4) exactly as visitors see it. The public page, the owner's
 * "View as a visitor" preview and the edit page's layout all come from here, so what an
 * owner sees while editing is what visitors get (D-34). The approved design (D-58): photos on
 * top, the name with its cost and rating, About, Services (never prices), then `main` (reviews);
 * on computers a column beside it with `children` (how to plan with them) over Where and Contact.
 */
export function VendorPage({
  vendor,
  rating,
  crumb,
  main,
  children,
}: {
  vendor: VendorView;
  rating?: VendorRating;
  crumb?: ReactNode;
  main?: ReactNode;
  children?: ReactNode;
}) {
  const photos = vendor.photos ?? [];
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className={styles.page}>
      {crumb}
      {photos.length > 0 && <PhotoMosaic photos={photos} onOpen={setOpen} />}
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
          <Summary vendor={vendor} rating={rating} />

          {vendor.description && (
            <section aria-labelledby="about" className={styles.section}>
              <h2 id="about" className="label">
                About
              </h2>
              <p className={styles.about}>{vendor.description}</p>
            </section>
          )}

          {vendor.services.length > 0 && (
            <section aria-labelledby="services" className={styles.section}>
              <h2 id="services" className="label">
                Services
              </h2>
              {/* No prices, anywhere (D-58): people ask the business. */}
              <ul className={styles.services}>
                {vendor.services.map((s, i) => (
                  <li key={i} className={styles.service}>
                    <span className={styles.serviceName}>
                      <span className={styles.serviceTitle}>{s.name}</span>
                      {s.description && <span className={`muted ${styles.serviceDetails}`}>{s.description}</span>}
                    </span>
                    <span className={`muted ${styles.ask}`}>Ask them</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {main}
        </div>

        <aside className={styles.side} aria-label={`Plan with ${vendor.name}`}>
          {children}
          <section aria-labelledby="where" className={styles.card}>
            <h2 id="where" className="label">
              Where
            </h2>
            <p className={styles.place}>{vendor.town}</p>
            <h2 id="contact" className={`label ${styles.cardGap}`}>
              Contact
            </h2>
            {!vendor.claimed && (
              <p className="muted">
                Not on Localites yet. These are the business&rsquo;s own public details; arrange everything directly with them.
              </p>
            )}
            {!vendor.websiteUrl && !vendor.publicPhone && (
              <p className="muted">This business hasn&rsquo;t shared a website or phone number yet.</p>
            )}
            {(vendor.websiteUrl || vendor.publicPhone) && (
              <p className={styles.contact}>
                {vendor.websiteUrl && (
                  <a href={vendor.websiteUrl} className={styles.contactLink} rel="noopener nofollow" target="_blank" data-activity="website_tap">
                    {siteName(vendor.websiteUrl)}
                  </a>
                )}
                {vendor.publicPhone && (
                  <a href={`tel:${vendor.publicPhone.replace(/[^0-9+]/g, '')}`} className={styles.contactLink} data-activity="phone_tap">
                    {vendor.publicPhone}
                  </a>
                )}
              </p>
            )}
          </section>
        </aside>
      </div>
      {open !== null && <PhotoViewer photos={photos} start={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** A website as people say it: "lakesidehall.ca", not "https://www.lakesidehall.ca/". */
function siteName(url: string) {
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '');
    return u.hostname.replace(/^www\./, '') + path;
  } catch {
    return url;
  }
}
