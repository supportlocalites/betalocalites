import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useFetcher, useLocation, useSearchParams } from 'react-router';
import { useListActivity, useVendorActivity } from '@/components/ActivityTracker';
import { ReportLink, ReviewList, type ShownReview } from '@/components/Reviews';
import { directionsUrl, streetLine } from '@/lib/address';
import { fuzzyMatch } from '@/lib/fuzzy';
import type { DirectoryCard, ShortlistItem } from '@/server/browse.server';
import { type Bounds, DirectoryMap, type MapApi } from './DirectoryMap';
import { picksUndo } from './picksUndo';
import { ShortlistBar } from './ShortlistBar';
import { TopBar } from './TopBar';
import { useCloseOutside } from './useCloseOutside';
import styles from './Directory.module.css';

/**
 * Browse local in the Base44 design (D-59): the top bar with the search and its Filters list
 * (D-64); the map strip; the count; a row for each main kind of business (D-60); small cards with
 * the heart and the +; and the profile panel beside them. Filtering and ordering happen here in
 * the browser, as on Base44. What we built in (D-59 part 3): Message or Inquire, the shortlist,
 * Directions, reviews, and favourites kept with the account when signed in.
 */

const RATING = [
  { value: '', label: 'Any rating' },
  { value: '4.8', label: '4.8 & up' },
  { value: '4.5', label: '4.5 & up' },
  { value: '4', label: '4.0 & up' },
];
const SORT = [
  { value: 'top', label: 'Top rated' },
  { value: 'fast', label: 'Fastest reply' },
  { value: 'reviews', label: 'Most reviewed' },
];

export type ListTrack = { token: string; list: string } | null;

export const replyLabel = (minutes: number | null) => {
  if (minutes === null) return '—';
  const h = minutes / 60;
  if (h < 12) return `~${Math.max(1, Math.round(h))} hrs`;
  if (h < 36) return '~1 day';
  return `~${Math.round(h / 24)} days`;
};
export const ratingLabel = (r: number | null) => (r === null ? 'New' : r.toFixed(1));

/** Favourites without an account stay in this browser only, as on Base44 (D-59, K15). */
const LOCAL_KEY = 'localites:favourites';
const LOCAL_EVENT = 'localites:favourites';
const localFavourites = {
  subscribe(onChange: () => void) {
    window.addEventListener('storage', onChange);
    window.addEventListener(LOCAL_EVENT, onChange);
    return () => {
      window.removeEventListener('storage', onChange);
      window.removeEventListener(LOCAL_EVENT, onChange);
    };
  },
  read(): string {
    try {
      return window.localStorage.getItem(LOCAL_KEY) ?? '[]';
    } catch {
      return '[]';
    }
  },
  parse(raw: string): string[] {
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  },
  toggle(slug: string) {
    const now = localFavourites.parse(localFavourites.read());
    const next = now.includes(slug) ? now.filter((s) => s !== slug) : [...now, slug];
    try {
      window.localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
    } catch {
      // Storage off: nothing is kept.
    }
    window.dispatchEvent(new Event(LOCAL_EVENT));
  },
};

type View = 'map' | 'hybrid' | 'list';

export function Directory({
  cards,
  kinds,
  shortlist,
  signedIn,
  tracks,
  initial,
  initialTrack = null,
  initialReviews = null,
}: {
  cards: DirectoryCard[];
  kinds: { slug: string; name: string }[];
  shortlist: ShortlistItem[];
  signedIn: boolean;
  tracks: Record<string, ListTrack>;
  /** The business opened by its own web address (/vendors/:slug). */
  initial: string | null;
  /** That visit's note, made with the page (it knows where the visitor came from). */
  initialTrack?: string | null;
  /** That business's reviews, sent with the page. */
  initialReviews?: PanelData['reviews'] | null;
}) {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [rating, setRating] = useState('');
  const [sort, setSort] = useState('top');
  // Kinds of business chosen (none: all), and only favourites (the owner, 24 October 2026).
  const [chosen, setChosen] = useState<string[]>([]);
  const [favOnly, setFavOnly] = useState(false);
  // Map and rows (the start), the map expanded, or the list expanded (the owner, 24 October 2026:
  // Base44's "Expand map" on the map, and an expand for the list above the rows).
  const [view, setView] = useState<View>('hybrid');
  const [wide, setWide] = useState(false);
  // "Search this area": the part of the map searched, and what the filters were then.
  const [area, setArea] = useState<Bounds | null>(null);
  const [moved, setMoved] = useState(false);
  const filterKey = JSON.stringify([query.trim(), rating, chosen, favOnly]);
  const [searchedKey, setSearchedKey] = useState(filterKey);
  const mapApi = useRef<MapApi | null>(null);
  const onMapReady = useCallback((api: MapApi | null) => {
    mapApi.current = api;
  }, []);
  // ?v= names the open business; on a business's own address it's open until closed (v empty).
  const selected = params.has('v') ? params.get('v') || null : initial;
  // Which business is open, in the address (?v=).
  const setOpen = useCallback(
    (slug: string | null) =>
      setParams(
        (p) => {
          const next = new URLSearchParams(p);
          if (slug) next.set('v', slug);
          else if (initial) next.set('v', '');
          else next.delete('v');
          return next;
        },
        { replace: true, preventScrollReset: true },
      ),
    [setParams, initial],
  );
  const select = useCallback(
    (slug: string | null) => {
      // A business opened from nothing open starts as the drawer, not the sheet.
      if (slug && !selected) setWide(false);
      setOpen(slug);
    },
    [setOpen, selected],
  );

  // Closing the profile (×, Esc, or outside the sheet). The sheet stays a sheet until it's gone,
  // so the drawer never flashes up on the way out.
  const closeSheet = useCallback(() => select(null), [select]);

  // Favourites: the account's when signed in, this browser's when not.
  const local = localFavourites.parse(useSyncExternalStore(localFavourites.subscribe, localFavourites.read, () => '[]'));
  const isFavourite = useCallback((c: DirectoryCard) => (signedIn ? c.saved : local.includes(c.slug)), [signedIn, local]);
  const favourites = cards.filter((c) => c.kindSlug && isFavourite(c)).length;
  // The businesses they run, for the profile menu's account switch (D-63); listed ones are on this page.
  const yourBusinesses = useMemo(
    () => cards.filter((c) => c.yours !== null).map((c) => ({ slug: c.slug, name: c.name, role: c.yours!, analytics: false })),
    [cards],
  );

  // The count and the map follow the rows, as on Base44: a business with no main kind that's
  // showing isn't in a row, but its own address still opens its profile.
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = cards.filter((c) => {
      if (!c.kindSlug) return false;
      if (chosen.length > 0 && !chosen.includes(c.kindSlug)) return false;
      if (favOnly && !isFavourite(c)) return false;
      if (rating && (c.rating ?? 0) < Number(rating)) return false;
      // Forgiving of spelling (the owner, 24 October 2026).
      if (needle && !fuzzyMatch(needle, [c.name, c.tagline ?? '', c.kind ?? '', c.sub ?? '', c.place, ...c.tags].join(' '))) return false;
      if (area && !(c.lat !== null && c.lng !== null && inside(area, c.lat, c.lng))) return false;
      return true;
    });
    const sorted = [...list];
    if (sort === 'fast') sorted.sort((a, b) => (a.replyMinutes ?? Infinity) - (b.replyMinutes ?? Infinity));
    else if (sort === 'reviews') sorted.sort((a, b) => b.reviews - a.reviews);
    else sorted.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    return sorted;
  }, [cards, query, rating, sort, chosen, favOnly, isFavourite, area]);
  const filtering = Boolean(query.trim() || rating || sort !== 'top' || chosen.length || favOnly || area);

  const rails = useMemo(
    () => kinds.map((k) => ({ ...k, items: filtered.filter((c) => c.kindSlug === k.slug) })).filter((r) => r.items.length > 0),
    [kinds, filtered],
  );
  // Every business the filters show, in the order of the rows: the profile steps through these.
  const ordered = useMemo(() => rails.flatMap((r) => r.items), [rails]);
  const open = cards.find((c) => c.slug === selected) ?? null;
  const position = ordered.findIndex((c) => c.slug === selected);
  // "More … businesses": the same kind, as the filters choose them; with no filters, the best
  // rated first, then the quickest to reply.
  const similar = useMemo(() => {
    if (!open) return [];
    const same = filtered.filter((c) => c.slug !== open.slug && c.kindSlug === open.kindSlug);
    if (!filtering) {
      same.sort(
        (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || (a.replyMinutes ?? Infinity) - (b.replyMinutes ?? Infinity),
      );
    }
    return same.slice(0, 3);
  }, [open, filtered, filtering]);
  const step = useCallback(
    (delta: number) => {
      if (ordered.length < 2 || position < 0) return;
      select(ordered[(position + delta + ordered.length) % ordered.length]!.slug);
    },
    [ordered, position, select],
  );

  // A business the filters now hide closes, as on Base44.
  useEffect(() => {
    if (selected && open?.kindSlug && !filtered.some((c) => c.slug === selected)) setOpen(null);
  }, [filtered, selected, open, setOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      if (e.key === 'Escape') closeSheet();
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, closeSheet]);

  const heart = (c: DirectoryCard, big = false) => (
    <Heart card={c} big={big} signedIn={signedIn} on={isFavourite(c)} onLocal={() => localFavourites.toggle(c.slug)} />
  );
  const onMoved = useCallback(() => setMoved(true), []);
  // Clickable once the map was moved or a filter changed since the last search.
  const canSearchArea = moved || filterKey !== searchedKey;
  const searchArea = () => {
    const b = mapApi.current?.bounds();
    if (!b) return;
    setArea(b);
    setMoved(false);
    setSearchedKey(filterKey);
  };
  const clear = () => {
    setQuery('');
    setRating('');
    setSort('top');
    setChosen([]);
    setFavOnly(false);
    setArea(null);
    setMoved(false);
    setSearchedKey(JSON.stringify(['', '', [], false]));
  };
  const profileView = open ? (
      <Profile
        key={open.slug}
        card={open}
        wide={wide}
        onWide={() => setWide((v) => !v)}
        onClose={closeSheet}
        onSelect={select}
        onStep={step}
        position={{ index: position + 1, total: position >= 0 ? ordered.length : 0 }}
        similar={similar}
        heart={heart}
        signedIn={signedIn}
        pageTrack={open.slug === initial ? initialTrack : null}
        pageReviews={open.slug === initial ? initialReviews : null}
        listPlace={(() => {
          const t = open.kindSlug ? tracks[open.kindSlug] : null;
          const pos = cards.filter((c) => c.kindSlug === open.kindSlug).findIndex((c) => c.slug === open.slug);
          return t && pos >= 0 ? { pos: pos + 1, list: t.list } : null;
        })()}
      />
  ) : null;
  const mapShown = view !== 'list';

  return (
    <div className={styles.screen}>
      <TopBar
        onTeam={cards.some((c) => c.yours !== null)}
        businesses={yourBusinesses}
        favourites={{ on: favOnly, count: favourites, toggle: () => setFavOnly((v) => !v) }}
      >
        <div className={styles.search} role="search">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={styles.searchIcon}>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <label htmlFor="q" className="visually-hidden">
            Search businesses
          </label>
          <input
            id="q"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or what they do..."
            className={styles.searchInput}
            maxLength={100}
            autoComplete="off"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className={styles.searchClear}>
              <Icon name="x" />
            </button>
          )}
          <Filters
            kinds={kinds}
            chosen={chosen}
            onChosen={setChosen}
            rating={rating}
            onRating={setRating}
            sort={sort}
            onSort={setSort}
            onReset={() => {
              setChosen([]);
              setRating('');
              setSort('top');
              setArea(null);
              setMoved(false);
              setSearchedKey(JSON.stringify([query.trim(), '', [], favOnly]));
            }}
          />
        </div>
      </TopBar>

      <div className={`${styles.body} ${open ? styles.bodyOpen : ''}`}>
        <div className={styles.left}>
          {mapShown && (
            <DirectoryMap
              cards={filtered}
              selected={selected}
              onSelect={select}
              layout={`${view}|${open ? 'open' : 'shut'}|${wide}`}
              panelOpen={Boolean(open) && !wide}
              onMoved={onMoved}
              onReady={onMapReady}
              className={`${styles.map} ${view === 'map' ? styles.mapBig : ''}`}
            >
              <div className={`${styles.mapFoot} ${view === 'map' ? styles.mapFootRaised : ''}`}>
                <button type="button" onClick={searchArea} disabled={!canSearchArea} className={styles.searchArea}>
                  <Icon name="search" small />
                  Search this area
                </button>
              </div>
              {view === 'map' && ordered.length > 0 && (
                <Strip items={ordered} selected={selected} onSelect={select} heart={heart} signedIn={signedIn} />
              )}
              <button type="button" onClick={() => setView(view === 'map' ? 'hybrid' : 'map')} className={styles.expand}>
                <Icon name={view === 'map' ? 'min' : 'max'} small />
                {view === 'map' ? 'Collapse' : 'Expand map'}
              </button>
            </DirectoryMap>
          )}

          {view !== 'map' && (
            <div className={styles.viewbar}>
              <p className={styles.count}>
                <span className={styles.countNumber}>
                  {ordered.length} {ordered.length === 1 ? 'business' : 'businesses'}
                </span>
                <span className={styles.dotSep} aria-hidden="true">
                  ·
                </span>
                <span className={styles.countHint}>Click a business to open the profile</span>
              </p>
              <button type="button" onClick={() => setView(view === 'list' ? 'hybrid' : 'list')} className={styles.expandList}>
                <Icon name={view === 'list' ? 'min' : 'max'} small />
                {view === 'list' ? 'Collapse' : 'Expand list'}
              </button>
            </div>
          )}

          <div className={`${styles.rails} ${view === 'map' ? styles.hidden : ''}`}>
            {rails.length === 0 ? (
              <div className={styles.empty}>
                <p className={styles.emptyTitle}>{favOnly && favourites === 0 ? 'No favourites yet' : 'Nothing matches those filters'}</p>
                <p className={styles.emptyHint}>
                  {favOnly && favourites === 0
                    ? 'Tap the heart on any business to keep it here.'
                    : area
                      ? 'Try moving the map, or clearing the filters.'
                      : 'Try clearing the filters or the search.'}
                </p>
                {filtering && (
                  <button type="button" onClick={clear} className={styles.pickerAll}>
                    Reset
                  </button>
                )}
                <Link to={`/suggest${query ? `?q=${encodeURIComponent(query)}` : ''}`} className={styles.suggest}>
                  Can’t find it? Suggest a business
                </Link>
              </div>
            ) : (
              rails.map((r) => (
                <Rail key={r.slug} rail={r} track={tracks[r.slug] ?? null} selected={selected} onSelect={select} heart={heart} signedIn={signedIn} />
              ))
            )}
          </div>
          <ShortlistBar items={shortlist} />
        </div>

        <div className={`${styles.panelBox} ${open && !wide ? styles.panelOpen : ''}`}>
          {open && !wide && profileView}
          {/* On a phone, the other businesses stay in reach along the bottom (the owner, 26 October 2026:
              "feel like they can still navigate other vendors while looking at the current vendor"). */}
          {open && !wide && ordered.length > 1 && <PeekRow items={ordered} selected={selected} onSelect={select} />}
        </div>
      </div>
      {/* Expanded, the profile is a sheet over the page (the owner, 24 October 2026): a click
          anywhere outside it closes it, as does its ×. */}
      {open && wide && (
        <Sheet name={open.name} onClose={closeSheet}>
          {profileView}
        </Sheet>
      )}
    </div>
  );
}

/** The expanded profile: a large card over a dimmed page, closed by clicking outside it, its ×, or Esc. */
function Sheet({ name, onClose, children }: { name: string; onClose: () => void; children: React.ReactNode }) {
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    card.current?.focus();
  }, []);
  return (
    <div className={styles.sheetBackdrop} onClick={onClose}>
      <div
        ref={card}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label={name}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

const inside = (b: Bounds, lat: number, lng: number) => lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east;

type Row = 'kinds' | 'rating' | 'sort';

/**
 * Filters (D-64), inside the search: one quiet list, a line for each filter with what it's set to,
 * and only the line tapped opens (the owner, 26 October 2026: "I like the quiet list", style 1,
 * drawn like the bar's own boxes; "SHOW ALL should say RESET"). The button shows how many are on.
 */
function Filters({
  kinds,
  chosen,
  onChosen,
  rating,
  onRating,
  sort,
  onSort,
  onReset,
}: {
  kinds: { slug: string; name: string }[];
  chosen: string[];
  onChosen: (next: string[]) => void;
  rating: string;
  onRating: (v: string) => void;
  sort: string;
  onSort: (v: string) => void;
  onReset: () => void;
}) {
  const box = useRef<HTMLDetailsElement>(null);
  useCloseOutside(box);
  const [row, setRow] = useState<Row | null>(null);
  const on = (chosen.length > 0 ? 1 : 0) + (rating ? 1 : 0);
  const kindWords = chosen.length === 0 ? 'All' : chosen.length === 1 ? (kinds.find((k) => k.slug === chosen[0])?.name ?? '1 category') : `${chosen.length} categories`;
  const line = (id: Row, label: string, value: string) => (
    <button type="button" className={styles.filterRow} aria-expanded={row === id} aria-controls={`filter-${id}`} onClick={() => setRow(row === id ? null : id)}>
      <span className={styles.filterWords}>
        <span className={styles.selectLabel}>{label}</span>
        <span className={styles.pickerValue}>{value}</span>
      </span>
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={styles.filterChevron}>
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>
  );
  const one = (id: 'rating' | 'sort', label: string, value: string, onChange: (v: string) => void, options: { value: string; label: string }[]) => (
    <>
      {line(id, label, options.find((o) => o.value === value)?.label ?? options[0]!.label)}
      {row === id && (
        <fieldset id={`filter-${id}`} className={styles.filterChoices}>
          <legend className="visually-hidden">{label}</legend>
          {options.map((o) => (
            <label key={o.value} className={styles.pickerItem}>
              <input type="radio" name={id} checked={value === o.value} onChange={() => onChange(o.value)} className={styles.filterTick} />
              {o.label}
            </label>
          ))}
        </fieldset>
      )}
    </>
  );
  return (
    <details className={styles.filters} ref={box} onToggle={(e) => !e.currentTarget.open && setRow(null)}>
      <summary className={styles.filtersButton} aria-label={on ? `Filters, ${on} on` : 'Filters'}>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={styles.filtersIcon}>
          <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
          <circle cx="16" cy="7" r="2" />
          <circle cx="10" cy="17" r="2" />
        </svg>
        <span className={styles.filtersWord}>Filters</span>
        {on > 0 && (
          <span className={styles.filtersCount} aria-hidden="true">
            {on}
          </span>
        )}
      </summary>
      <div className={styles.filterList}>
        {line('kinds', 'Categories', kindWords)}
        {row === 'kinds' && (
          <fieldset id="filter-kinds" className={styles.filterChoices}>
            <legend className="visually-hidden">Categories to show</legend>
            {kinds.map((k) => (
              <label key={k.slug} className={styles.pickerItem}>
                <input
                  type="checkbox"
                  checked={chosen.includes(k.slug)}
                  onChange={(e) => onChosen(e.target.checked ? [...chosen, k.slug] : chosen.filter((x) => x !== k.slug))}
                  className={styles.filterTick}
                />
                {k.name}
              </label>
            ))}
          </fieldset>
        )}
        {one('rating', 'Rating', rating, onRating, RATING)}
        {one('sort', 'Sort', sort, onSort, SORT)}
        <div className={styles.filterFoot}>
          <button
            type="button"
            className={styles.pickerAll}
            onClick={() => {
              onReset();
              setRow(null);
            }}
          >
            Reset
          </button>
          <button
            type="button"
            className={styles.filtersDone}
            onClick={() => {
              if (box.current) box.current.open = false;
            }}
          >
            Show results
          </button>
        </div>
      </div>
    </details>
  );
}

type HeartFn = (c: DirectoryCard, big?: boolean) => React.ReactNode;

function Rail({
  rail,
  track,
  selected,
  onSelect,
  heart,
  signedIn,
}: {
  rail: { slug: string; name: string; items: DirectoryCard[] };
  track: ListTrack;
  selected: string | null;
  onSelect: (slug: string) => void;
  heart: HeartFn;
  signedIn: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [first] = useState(track);
  useListActivity(first?.token ?? null, scroller, useLocation().key);
  const forward = () => {
    const el = scroller.current;
    if (!el) return;
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 8;
    el.scrollBy({ left: atEnd ? -el.scrollWidth : Math.round(el.clientWidth * 0.8), behavior: 'smooth' });
  };
  return (
    <section className={styles.rail} aria-labelledby={`rail-${rail.slug}`}>
      <div className={styles.railHead}>
        <div className={styles.railTitle}>
          <h2 id={`rail-${rail.slug}`} className={styles.railName}>
            {rail.name}
          </h2>
          <span className={styles.railCount}>{rail.items.length}</span>
        </div>
        <button type="button" onClick={forward} className={styles.scroll} aria-label={`Scroll ${rail.name}`}>
          Scroll
          <Icon name="arrow" />
        </button>
      </div>
      <div ref={scroller} className={styles.row}>
        {rail.items.map((c, i) => (
          <MiniCard key={c.id} card={c} pos={i + 1} selected={selected} onSelect={onSelect} heart={heart} signedIn={signedIn} />
        ))}
      </div>
    </section>
  );
}

/**
 * On the full map, every business the filters show in one line along the bottom, in the order
 * ‹ › steps through; the open one slides into view, whether tapped here or on the map.
 */
function Strip({
  items,
  selected,
  onSelect,
  heart,
  signedIn,
}: {
  items: DirectoryCard[];
  selected: string | null;
  onSelect: (slug: string) => void;
  heart: HeartFn;
  signedIn: boolean;
}) {
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const i = items.findIndex((c) => c.slug === selected);
    const card = i >= 0 ? row.current?.children[i] : null;
    card?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [items, selected]);
  return (
    <div className={styles.strip}>
      <div className={styles.row} ref={row}>
        {items.map((c, i) => (
          <MiniCard key={c.id} card={c} pos={i + 1} selected={selected} onSelect={onSelect} heart={heart} signedIn={signedIn} />
        ))}
      </div>
    </div>
  );
}

/**
 * On a phone with a profile open: every business the filters show, as small cards in one line
 * along the bottom, the open one marked and kept in view; a tap opens another.
 */
function PeekRow({ items, selected, onSelect }: { items: DirectoryCard[]; selected: string | null; onSelect: (slug: string) => void }) {
  const row = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const i = items.findIndex((c) => c.slug === selected);
    const el = i >= 0 ? row.current?.children[i] : null;
    // Only the row scrolls sideways; the page itself never jumps.
    if (el instanceof HTMLElement && row.current) {
      row.current.scrollTo({ left: el.offsetLeft - (row.current.clientWidth - el.clientWidth) / 2, behavior: 'smooth' });
    }
  }, [items, selected]);
  return (
    <nav className={styles.peek} aria-label="Other businesses in your search">
      <ul ref={row} className={styles.peekRow}>
        {items.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              className={`${styles.peekCard} ${c.slug === selected ? styles.peekOn : ''}`}
              aria-current={c.slug === selected ? 'true' : undefined}
              onClick={() => onSelect(c.slug)}
            >
              <span className={styles.peekKind}>{c.sub ?? c.kind}</span>
              <span className={styles.peekName}>{c.name}</span>
              <span className={styles.peekMeta}>
                <Icon name="star" tiny />
                {ratingLabel(c.rating)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** One small card (Base44's): in a row, and along the bottom of the full map. */
function MiniCard({
  card: c,
  pos,
  selected,
  onSelect,
  heart,
  signedIn,
}: {
  card: DirectoryCard;
  pos: number;
  selected: string | null;
  onSelect: (slug: string) => void;
  heart: HeartFn;
  signedIn: boolean;
}) {
  return (
    <article className={`${styles.card} ${c.slug === selected ? styles.cardOpen : ''}`} data-pos={pos}>
      <button type="button" className={styles.cardHit} onClick={() => onSelect(c.slug)} aria-label={`Open ${c.name}`} />
      <span className={styles.stripe} aria-hidden="true" />
      <p className={styles.cardKind}>
        {c.sub ?? c.kind}
        {c.bestRated && <span className={styles.best}>Best rated</span>}
      </p>
      <h3 className={styles.cardName}>{c.name}</h3>
      {c.tagline && <p className={styles.cardTagline}>{c.tagline}</p>}
      <Meta card={c} />
      {/* Not on the business's own team's cards (C6): they don't shortlist or save their own. */}
      {!c.yours && (
        <div className={styles.cardButtons}>
          <Plus card={c} signedIn={signedIn} />
          {heart(c)}
        </div>
      )}
    </article>
  );
}

function Meta({ card }: { card: DirectoryCard }) {
  return (
    <div className={styles.meta}>
      <span className={styles.metaItem}>
        <Icon name="star" tiny />
        <span className={styles.strong}>{ratingLabel(card.rating)}</span>
      </span>
      <span className={styles.metaItem}>
        <Icon name="clock" tiny />
        {replyLabel(card.replyMinutes)}
      </span>
    </div>
  );
}

/** The heart (D-59, K8): the account's favourites when signed in; this browser's when not. */
function Heart({
  card,
  big,
  signedIn,
  on,
  onLocal,
}: {
  card: DirectoryCard;
  big: boolean;
  signedIn: boolean;
  on: boolean;
  onLocal: () => void;
}) {
  const location = useLocation();
  const fetcher = useFetcher();
  const shown = fetcher.formData ? fetcher.formData.get('intent') === 'save' : on;
  const className = `${styles.heart} ${big ? styles.heartBig : ''} ${shown ? styles.heartOn : ''}`;
  const label = shown ? `Remove ${card.name} from favourites` : `Add ${card.name} to favourites`;
  if (!signedIn) {
    return (
      <button type="button" className={className} aria-label={label} aria-pressed={shown} onClick={onLocal}>
        <Icon name="heart" />
      </button>
    );
  }
  return (
    <fetcher.Form method="post" action="/shortlist" preventScrollReset className={styles.inlineForm}>
      <input type="hidden" name="intent" value={shown ? 'unsave' : 'save'} />
      <input type="hidden" name="slug" value={card.slug} />
      <input type="hidden" name="back" value={location.pathname + location.search} />
      <input type="hidden" name="inline" value="1" />
      <button type="submit" className={className} aria-label={label} aria-pressed={shown}>
        <Icon name="heart" />
      </button>
    </fetcher.Form>
  );
}

/** The + (D-59, K9: kept beside the heart): the shortlist, for Message all. Needs an account. */
function Plus({ card, signedIn, words = false }: { card: DirectoryCard; signedIn: boolean; words?: boolean }) {
  const location = useLocation();
  const fetcher = useFetcher();
  const back = location.pathname + location.search;
  const on = fetcher.formData ? fetcher.formData.get('intent') === 'add' : card.shortlisted;
  // Picked, it's a solid dark circle with a white tick, plainly different from the + (the owner,
  // 25 October 2026: "whatever it uses right now is indistinguishable").
  const className = words
    ? `${styles.action} ${on ? styles.actionPicked : styles.actionOutline}`
    : `${styles.heart} ${on ? styles.plusOn : ''}`;
  const text = words ? <span>{on ? 'In my picks' : 'Add to my picks'}</span> : null;
  if (!signedIn) {
    return (
      <Link
        to={`/join?next=${encodeURIComponent(back)}`}
        className={className}
        aria-label={`Sign in to add ${card.name} to your picks`}
        title="Add to my picks"
      >
        <Icon name="plus" />
        {text}
      </Link>
    );
  }
  const error = fetcher.state === 'idle' ? (fetcher.data as { error?: string } | undefined)?.error : null;
  return (
    <fetcher.Form
      method="post"
      action="/shortlist"
      preventScrollReset
      className={styles.inlineForm}
      onSubmit={() => {
        if (on) picksUndo.removed(card.slug, card.name);
      }}
    >
      <input type="hidden" name="intent" value={on ? 'remove' : 'add'} />
      <input type="hidden" name="slug" value={card.slug} />
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="inline" value="1" />
      <button
        type="submit"
        className={className}
        aria-label={on ? `Remove ${card.name} from my picks` : `Add ${card.name} to my picks`}
        aria-pressed={on}
        title={on ? 'Remove from my picks' : 'Add to my picks'}
      >
        <Icon name={on ? 'check' : 'plus'} />
        {text}
      </button>
      {error && (
        <span role="alert" className={styles.error}>
          {error}
        </span>
      )}
    </fetcher.Form>
  );
}

type PanelData = { reviews: { count: number; average: number | null; reviews: ShownReview[] }; track: string | null };

function Profile({
  card,
  wide,
  onWide,
  onClose,
  onSelect,
  onStep,
  position,
  similar,
  heart,
  signedIn,
  pageTrack,
  pageReviews,
  listPlace,
}: {
  card: DirectoryCard;
  wide: boolean;
  onWide: () => void;
  onClose: () => void;
  onSelect: (slug: string) => void;
  onStep: (delta: number) => void;
  position: { index: number; total: number };
  similar: DirectoryCard[];
  heart: HeartFn;
  signedIn: boolean;
  pageTrack: string | null;
  pageReviews: PanelData['reviews'] | null;
  listPlace: { pos: number; list: string } | null;
}) {
  const panel = useFetcher<PanelData>();
  const { load } = panel;
  // The business opened by its own address already has its reviews and visit note.
  const ready = pageReviews !== null;
  useEffect(() => {
    if (!ready) void load(`/vendors/${card.slug}/panel`);
  }, [card.slug, load, ready]);
  const reviews = pageReviews ?? panel.data?.reviews ?? null;
  const ref = useRef<HTMLElement>(null);
  const location = useLocation();
  // Opening a profile is a visit to the business's page (ADR-030).
  const onTap = useVendorActivity(pageTrack ?? panel.data?.track ?? null, ref, listPlace, `panel:${card.slug}:${location.key}`);
  return (
    <aside className={styles.panel} aria-label={card.name} ref={ref} onClickCapture={onTap}>
      <div className={styles.photo}>
        {card.photo ? (
          <img src={card.photo} alt={card.photoAlt} className={styles.photoImg} />
        ) : (
          <span className={styles.photoBlank}>{card.name}</span>
        )}
        <div className={styles.tools}>
          {!card.yours && heart(card, true)}
          <button type="button" className={styles.tool} onClick={onWide} aria-label={wide ? 'Collapse to drawer' : 'Expand to sheet'}>
            <Icon name={wide ? 'min' : 'max'} />
          </button>
          <button type="button" className={styles.tool} onClick={onClose} aria-label="Close profile">
            <Icon name="x" />
          </button>
        </div>
        {position.total > 1 && (
          <div className={styles.stepper}>
            <button type="button" onClick={() => onStep(-1)} aria-label="Previous business" className={styles.stepButton}>
              <Icon name="left" />
            </button>
            <span className={styles.stepCount}>
              {position.index} / {position.total}
            </span>
            <button type="button" onClick={() => onStep(1)} aria-label="Next business" className={styles.stepButton}>
              <Icon name="right" />
            </button>
          </div>
        )}
      </div>

      <div className={styles.panelBody}>
        <div>
          <div className={styles.kicker}>
            <span className={styles.kickerKind}>{card.sub ?? card.kind}</span>
            <span className={styles.dotSep} aria-hidden="true">
              ·
            </span>
            <span>{card.place}</span>
          </div>
          <h2 className={styles.panelName}>{card.name}</h2>
          <div className={styles.panelMeta}>
            <span className={styles.metaItem}>
              <Icon name="star" />
              <span className={styles.strong}>{ratingLabel(card.rating)}</span>
              <span className={styles.faint}>({card.reviews})</span>
            </span>
            <span className={styles.metaItem}>
              <Icon name="clock" />
              Replies {replyLabel(card.replyMinutes)}
            </span>
          </div>
          {card.tagline && <p className={styles.panelTagline}>{card.tagline}</p>}
          {card.about && <p className={styles.panelAbout}>{card.about}</p>}
          {/* No Curator's note (the owner, 25 October 2026); the team's notes stay in the database. */}
          {card.tags.length > 0 && (
            <div className={styles.tags}>
              {card.tags.map((t) => (
                <span key={t} className={styles.tag}>
                  {t}
                </span>
              ))}
            </div>
          )}

          {/* Built in (D-59, G1, G2, G9, G14): talk to the business, the shortlist, directions. */}
          {card.yours ? (
            // C6 (D-54): someone on its team sees what they can do, not the customer's buttons.
            <div className={styles.yours}>
              <p className={styles.label}>This is your business</p>
              <p className={styles.small}>You’re on {card.name}’s team, so this is how customers see it. Messages and favourites are for customers.</p>
              <div className={styles.actions}>
                <Link to="/business" className={`${styles.action} ${styles.actionDark}`}>
                  My business
                </Link>
                {card.yours !== 'staff' && (
                  <Link to={`/vendors/${card.slug}/edit`} className={`${styles.action} ${styles.actionOutline}`}>
                    Edit your listing
                  </Link>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className={styles.actions}>
                {card.claimed ? (
                  <Link to={`/vendors/${card.slug}/message`} className={`${styles.action} ${styles.actionDark}`}>
                    Message {card.name}
                  </Link>
                ) : (
                  <Link to={`/vendors/${card.slug}/inquire`} className={`${styles.action} ${styles.actionDark}`}>
                    Inquire
                  </Link>
                )}
                <Plus card={card} signedIn={signedIn} words />
              </div>
              {!card.claimed && <p className={styles.small}>{card.name} isn’t on Localites yet. Inquire and our team will invite them.</p>}
            </>
          )}
          {card.street && (
            <p className={styles.small}>
              {card.approximate ? 'Approximate location: ' : ''}
              {/* Never a hidden number or unit: they aren't kept (0054, 0059). */}
              {streetLine({ street: card.street, number: card.number, unit: card.unit, hidden: false })}, {card.town} ·{' '}
              <a
                href={directionsUrl({ street: card.street, number: card.number, hidden: false }, card.town)}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.link}
              >
                Directions
              </a>
            </p>
          )}

          {/* Reviews listed (D-59, K22). */}
          {reviews && reviews.count > 0 && (
            <section className={styles.reviews} aria-label="Reviews">
              <p className={styles.label}>Reviews</p>
              <ReviewList
                businessName={card.name}
                count={reviews.count}
                average={reviews.average}
                reviews={reviews.reviews}
                after={(r) => <ReportLink to={`/reviews/${r.id}/report`} />}
              />
            </section>
          )}
        </div>

        {similar.length > 0 && (
          <div className={styles.similar}>
            <p className={styles.label}>More {(card.kind ?? '').toLowerCase()} businesses</p>
            <div className={styles.similarList}>
              {similar.map((s) => (
                <button key={s.slug} type="button" className={styles.similarItem} onClick={() => onSelect(s.slug)}>
                  <span className={styles.similarThumb}>{s.smallPhoto && <img src={s.smallPhoto} alt="" />}</span>
                  <span className={styles.similarWords}>
                    <span className={styles.similarName}>{s.name}</span>
                    <span className={styles.similarMeta}>
                      <Icon name="star" tiny />
                      <span className={styles.strong}>{ratingLabel(s.rating)}</span>
                      <span className={styles.dotSep} aria-hidden="true">
                        ·
                      </span>
                      {s.place}
                    </span>
                  </span>
                  <Icon name="out" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

const PATHS: Record<string, React.ReactNode> = {
  star: <path className={styles.fill} d="M12 2.5l2.9 6 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.2 1.3-6.6-4.9-4.6 6.6-.8z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </>
  ),
  heart: <path d="M12 20s-7.5-4.6-9.3-9.2C1.4 7.4 3.6 4 7 4c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.4 0 5.6 3.4 4.3 6.8C19.5 15.4 12 20 12 20z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  chat: <path d="M4 5h16v11H9l-5 4z" />,
  people: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 19c.8-3.2 3.2-5 6-5s5.2 1.8 6 5M17 6.6a2.4 2.4 0 1 1 0 4.8M18 14c1.6.5 2.6 2 3 5" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  max: <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />,
  min: <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  left: <path d="m15 18-6-6 6-6" />,
  right: <path d="m9 18 6-6-6-6" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  out: <path d="M7 17 17 7M8 7h9v9" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
};

function Icon({ name, tiny = false, small = false }: { name: string; tiny?: boolean; small?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={`${styles.icon} ${tiny ? styles.iconTiny : small ? styles.iconSmall : ''} ${name === 'star' ? styles.star : ''}`}
    >
      {PATHS[name]}
    </svg>
  );
}
