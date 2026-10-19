import { useSyncExternalStore } from 'react';
import { Link, useFetcher, useLocation } from 'react-router';
import type { BrowseCard as Card } from '@/server/browse.server';
import styles from './BrowseCard.module.css';

export const COST_WORDS = ['', 'Low cost', 'Medium cost', 'High cost'];

/** True once the page's scripts run: the buttons then answer in place instead of reloading. */
const noChange = () => () => {};
function useHydrated() {
  return useSyncExternalStore(noChange, () => true, () => false);
}

/** $ to $$$ (D-56): the cost the team set, in ink, and the rest of the scale in the muted colour. */
export function Cost({ level }: { level: number | null }) {
  if (!level) return null;
  return (
    <span className={styles.cost}>
      <span className="visually-hidden">{COST_WORDS[level]}</span>
      <span aria-hidden="true">
        <span className={styles.costOn}>{'$'.repeat(level)}</span>
        <span className={styles.costOff}>{'$'.repeat(3 - level)}</span>
      </span>
    </span>
  );
}

function Rating({ reviews, average }: { reviews: number; average: number | null }) {
  const words =
    average != null ? `${average.toFixed(1)} (${reviews})` : reviews > 0 ? `${reviews} ${reviews === 1 ? 'review' : 'reviews'}` : 'New';
  return (
    <span className={styles.rating}>
      {average != null && (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={styles.star}>
          <path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7L12 17.3 5.8 20.9l1.6-7L2 9.2l7.1-.6z" />
        </svg>
      )}
      {average != null && <span className="visually-hidden">Rated </span>}
      {words}
      {average != null && <span className="visually-hidden"> out of 5, from {reviews} reviews</span>}
    </span>
  );
}

type Choosable = { slug: string; name: string; shortlisted: boolean; saved: boolean };

/**
 * The two buttons at a card's bottom right (D-57): + adds to the shortlist, the bookmark saves
 * as a favourite. Each posts to /shortlist as the signed-in person; signed out, each asks them
 * to sign in first and brings them back. look 'panel': on a business's page (D-58), the + with
 * its words, on the dark panel; 'bar': icons only, in the phone's bar there.
 */
export function ChoiceButtons({ card, signedIn, look = 'card' }: { card: Choosable; signedIn: boolean; look?: 'card' | 'panel' | 'bar' }) {
  const location = useLocation();
  const back = location.pathname + location.search;
  const hydrated = useHydrated();
  const shortlist = useFetcher();
  const favourite = useFetcher();
  // Shown at once while the change goes (the page reloads its data after).
  const shortlisted = shortlist.formData ? shortlist.formData.get('intent') === 'add' : card.shortlisted;
  const saved = favourite.formData ? favourite.formData.get('intent') === 'save' : card.saved;
  const plus = (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={styles.icon}>
      {shortlisted ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : <path d="M12 5v14M5 12h14" />}
    </svg>
  );
  const mark = (
    <svg viewBox="0 0 16 20" aria-hidden="true" focusable="false" className={`${styles.icon} ${saved ? styles.filled : ''}`}>
      <path d="M2 1.5h12v17l-6-4.2-6 4.2z" />
    </svg>
  );
  const panel = look === 'panel';
  // 'bar': the same dark buttons, icons only, in a phone's bar at the bottom of a business's page.
  const box = look === 'card' ? styles.button : `${styles.button} ${styles.panelButton}`;
  const wide = panel ? `${box} ${styles.panelWide}` : box;
  const words = panel ? <span aria-hidden="true">{shortlisted ? 'On your shortlist' : 'Add to shortlist'}</span> : null;
  if (!signedIn) {
    const join = `/join?next=${encodeURIComponent(back)}`;
    return (
      <div className={`${styles.buttons} ${panel ? styles.panelButtons : ''}`}>
        <Link to={join} className={wide} aria-label={`Sign in to add ${card.name} to your shortlist`} title="Add to shortlist">
          {plus}
          {words}
        </Link>
        <Link to={join} className={box} aria-label={`Sign in to save ${card.name} as a favourite`} title="Save as favourite">
          {mark}
        </Link>
      </div>
    );
  }
  const error =
    (shortlist.state === 'idle' && (shortlist.data as { error?: string } | undefined)?.error) ||
    (favourite.state === 'idle' && (favourite.data as { error?: string } | undefined)?.error) ||
    null;
  const shortTip = shortlisted ? 'Remove from shortlist' : 'Add to shortlist';
  const saveTip = saved ? 'Remove from favourites' : 'Save as favourite';
  return (
    <div className={`${styles.buttons} ${panel ? styles.panelButtons : ''}`}>
      <shortlist.Form method="post" action="/shortlist" preventScrollReset className={panel ? styles.panelGrow : undefined}>
        <input type="hidden" name="intent" value={shortlisted ? 'remove' : 'add'} />
        <input type="hidden" name="slug" value={card.slug} />
        <input type="hidden" name="back" value={back} />
        {hydrated && <input type="hidden" name="inline" value="1" />}
        <button
          type="submit"
          className={`${wide} ${shortlisted ? styles.chosen : ''}`}
          aria-label={shortlisted ? `Remove ${card.name} from your shortlist` : `Add ${card.name} to your shortlist`}
          title={shortTip}
        >
          {plus}
          {words}
        </button>
      </shortlist.Form>
      <favourite.Form method="post" action="/shortlist" preventScrollReset>
        <input type="hidden" name="intent" value={saved ? 'unsave' : 'save'} />
        <input type="hidden" name="slug" value={card.slug} />
        <input type="hidden" name="back" value={back} />
        {hydrated && <input type="hidden" name="inline" value="1" />}
        <button
          type="submit"
          className={box}
          aria-label={saved ? `Remove ${card.name} from your favourites` : `Save ${card.name} as a favourite`}
          title={saveTip}
        >
          {mark}
        </button>
      </favourite.Form>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}

/** One business on Browse local: its photo (or its name on a plain panel), kind, town, words, cost, rating, and the two buttons. */
export function BrowseCard({
  card,
  kind,
  signedIn,
  pos,
  listId,
}: {
  card: Card;
  kind: string;
  signedIn: boolean;
  pos: number;
  listId: string | null;
}) {
  return (
    <li className={`${styles.card} ${card.shortlisted ? styles.cardChosen : ''}`} data-pos={pos}>
      <Link to={`/vendors/${card.slug}`} state={listId ? { pos, list: listId } : undefined} className={styles.link}>
        <span className={styles.photo}>
          {card.photo ? <img src={card.photo} alt="" loading="lazy" className={styles.img} /> : <span className={styles.blank}>{card.name}</span>}
          <span className={styles.kind}>{kind}</span>
          <span className={styles.town}>
            <svg viewBox="0 0 24 34" aria-hidden="true" focusable="false" className={styles.pin}>
              <path
                fillRule="evenodd"
                d="M12 0C5.37 0 0 5.37 0 12c0 7.6 9.1 18.6 11.1 21a1.2 1.2 0 0 0 1.8 0C14.9 30.6 24 19.6 24 12 24 5.37 18.63 0 12 0zM12 6.6a5.4 5.4 0 1 1 0 10.8a5.4 5.4 0 0 1 0-10.8z"
              />
            </svg>
            {card.town}
          </span>
        </span>
        <span className={styles.words}>
          <span className={styles.name}>{card.name}</span>
          {card.tagline && <span className={styles.tagline}>{card.tagline}</span>}
        </span>
      </Link>
      <div className={styles.foot}>
        <span className={styles.meta}>
          <Cost level={card.cost} />
          <Rating reviews={card.reviews} average={card.average} />
        </span>
        <ChoiceButtons card={card} signedIn={signedIn} />
      </div>
    </li>
  );
}
