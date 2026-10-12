import { addDays, change, duration, ordinal, type Period, SMALL, small, SOURCE_WORDS } from '@/lib/activity';
import type { Report, Row, Totals } from '@/server/analytics.server';
import styles from './ActivityReport.module.css';

/**
 * A business's numbers (screen V10 for owners, and the team's view on X18). Totals only,
 * never who. On the owner's page small breakdown figures show as "fewer than 5".
 */

export const PERIOD_WORDS: Record<Period, { label: string; before: string; lastYear: string }> = {
  week: { label: 'Last week (Monday to Sunday)', before: 'the week before', lastYear: 'the same week last year' },
  month: { label: 'Last month', before: 'the month before', lastYear: 'the same month last year' },
  year: { label: 'This year so far', before: '', lastYear: 'the same time last year' },
};

const DEVICE_WORDS: Record<string, string> = { phone: 'Phone', tablet: 'Tablet', computer: 'Computer', unknown: 'Not known' };
const TOWN_WORDS: Record<string, string> = { elsewhere: 'Other towns', unknown: 'Not known' };
const LEFT_OUT_WORDS: Record<string, string> = {
  owner: 'Visits by the business’s own people',
  team: 'Visits by the Localites team',
  over_daily_cap: 'More than 3 opens in a day from one browser',
};

/** Fewer page opens than this in a period: the owner's page shows no breakdown. */
const MIN_TO_BREAK_DOWN = 10;

export const dateWords = (s: string) =>
  new Date(`${s}T12:00:00Z`).toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

const hourWords = (h: string) => {
  const n = Number(h);
  return `${n % 12 === 0 ? 12 : n % 12} ${n < 12 ? 'am' : 'pm'}`;
};

export function ActivityReport({
  report,
  hideSmall,
  has,
}: {
  report: Report;
  hideSmall: boolean;
  has: { website: boolean; phone: boolean; services: boolean };
}) {
  const words = PERIOD_WORDS[report.period];
  const num = (n: number) => (hideSmall ? small(n) : n.toLocaleString('en-CA'));
  // `hidden`: a figure the owner sees as "fewer than 5" when small; its comparison mustn't
  // give the exact number away.
  const compare = (pick: (t: Totals) => number | null, hidden = false) => {
    const now = pick(report.now);
    if (now === null) return null;
    const tooSmall = (n: number) => hidden && hideSmall && n < SMALL;
    const parts: string[] = [];
    const before = report.before ? pick(report.before) : null;
    if (before !== null && !tooSmall(now) && !tooSmall(before)) parts.push(change(now, before, words.before));
    if (report.lastYear) {
      const ly = pick(report.lastYear);
      if (ly !== null) parts.push(`${words.lastYear[0]!.toUpperCase()}${words.lastYear.slice(1)}: ${hidden ? num(ly) : ly.toLocaleString('en-CA')}`);
    }
    return parts.length ? parts.join(' · ') : null;
  };
  const t = report.now;
  const blocks: { label: string; value: string; note: string; compare: string | null }[] = [
    {
      label: 'Seen in lists',
      value: t.seen.toLocaleString('en-CA'),
      note: 'Times your business was at least half on someone’s screen, for at least a second, in Localites search results or a category list. Counted once per list shown, so someone who searches twice counts twice.',
      compare: compare((x) => x.seen),
    },
    ...(t.seen > 0
      ? [
          {
            label: 'Average place in lists',
            value: ordinal(Math.max(1, Math.round(t.positionSum / t.seen))),
            note: 'Where you appeared on average (1st is the top). In searches, order is by how well you match the words; in category lists, it’s alphabetical. Never paid for.',
            compare: null,
          },
        ]
      : []),
    {
      label: 'Page opened',
      value: t.views.toLocaleString('en-CA'),
      note: 'Times your page was opened. One browser counts at most 3 times a day.',
      compare: compare((x) => x.views),
    },
    ...(t.people !== null
      ? [
          {
            label: 'Different visitors',
            value: num(t.people),
            note: 'Counted by browser: one person on a phone and a computer counts twice.',
            compare: report.period === 'year' ? null : compare((x) => x.people, true),
          },
          {
            label: 'Came back',
            value: num(t.returning ?? 0),
            note: 'Visitors who had opened your page on an earlier day.',
            compare: null,
          },
        ]
      : []),
    {
      label: 'Website taps',
      value: has.website ? t.websiteTaps.toLocaleString('en-CA') : '—',
      note: has.website ? 'Taps on Visit website. People who type your address themselves aren’t counted, so this is at least the real number.' : 'Your listing has no website.',
      compare: has.website ? compare((x) => x.websiteTaps) : null,
    },
    {
      label: 'Phone taps',
      value: has.phone ? t.phoneTaps.toLocaleString('en-CA') : '—',
      note: has.phone ? 'Taps on Call. People who copy your number aren’t counted, so this is at least the real number.' : 'Your listing has no phone number.',
      compare: has.phone ? compare((x) => x.phoneTaps) : null,
    },
    {
      label: 'Time on your page',
      value: t.timedViews > 0 ? duration(t.profileSeconds / t.timedViews) : '—',
      note: 'On average, while the page was on screen.',
      compare: null,
    },
    ...(has.services
      ? [
          {
            label: 'Saw your services',
            value: t.servicesSeen.toLocaleString('en-CA'),
            note: 'Times your list of services was on screen for at least a second.',
            compare: compare((x) => x.servicesSeen),
          },
        ]
      : []),
  ];

  const table = (title: string, all: Row[], label: (v: string) => string, note?: string) => {
    const total = all.reduce((a, r) => a + r.views, 0);
    // On the owner's page, rows under 5 go together into one, so no small group of
    // visitors can be singled out; with very few visits, no breakdown at all.
    if (hideSmall && total > 0 && total < MIN_TO_BREAK_DOWN) {
      return (
        <section className={styles.section}>
          <h2 className="label">{title}</h2>
          <p className="muted">Not enough visits in this period to break down.</p>
        </section>
      );
    }
    const big = hideSmall ? all.filter((r) => r.views >= SMALL) : all;
    const rest = all.filter((r) => !big.includes(r)).reduce((a, r) => a + r.views, 0);
    const rows = rest > 0 ? [...big, { value: '__rest', views: rest }] : big;
    const name = (v: string) => (v === '__rest' ? 'Others, each fewer than 5' : label(v));
    return (
      <section className={styles.section}>
        <h2 className="label">{title}</h2>
        {note && <p className="muted">{note}</p>}
        {rows.length === 0 ? (
          <p className="muted">Nothing yet for this period.</p>
        ) : (
          <table className={styles.table}>
            <thead className="visually-hidden">
              <tr>
                <th scope="col">{title}</th>
                <th scope="col">Page opens</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.value}>
                  <th scope="row">{name(r.value)}</th>
                  <td>
                    <span className={styles.bar} style={{ ['--share' as string]: total ? r.views / total : 0 }} aria-hidden="true" />
                    {num(r.views)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    );
  };

  const lastDay = addDays(report.range.to, -1);
  const since = report.countingSince;
  return (
    <>
      {since === null ? (
        <p className="notice">Counting hasn’t started yet. Numbers appear the morning after the first visits are counted.</p>
      ) : since > lastDay ? (
        <p className="notice">
          {`Counting started on ${dateWords(since)}. ${report.period === 'year' ? 'Its numbers appear from the next morning.' : 'Choose “This year so far” to see them.'}`}
        </p>
      ) : since > report.range.from ? (
        <p className="notice">{`Counting started on ${dateWords(since)}, so this period is counted from then.`}</p>
      ) : null}
      {report.countedTo !== null && report.countedTo < lastDay && (
        <p className="muted">{`Page opens, taps and visitors are counted up to ${dateWords(report.countedTo)}; the days after are added each morning.`}</p>
      )}
      {report.limitedDays.length > 0 && (
        <p className="muted">{`On ${report.limitedDays.map(dateWords).join(', ')}, Localites reached its daily safety limit, so not every visit that day was counted.`}</p>
      )}
      {!report.lastYear && <p className="muted">Comparisons start once both periods have been fully counted.</p>}
      <ul className={styles.blocks}>
        {blocks.map((b) => (
          <li key={b.label} className={styles.block}>
            <span className={styles.count}>{b.value}</span>
            <span className="label">{b.label}</span>
            {b.compare && <span className={styles.compare}>{b.compare}</span>}
            <span className={`muted ${styles.note}`}>{b.note}</span>
          </li>
        ))}
      </ul>

      {table('How people found you', report.sources, (v) => SOURCE_WORDS[v] ?? v)}
      {table('Phone or computer', report.devices, (v) => DEVICE_WORDS[v] ?? v)}
      {table('Approximate town', report.towns, (v) => TOWN_WORDS[v] ?? v, 'From their internet connection, so it often shows a nearby larger town.')}
      {table('Busiest times of day', report.hours, hourWords, 'Toronto time.')}
      {!hideSmall && table('Left out of these numbers', report.leftOut, (v) => LEFT_OUT_WORDS[v] ?? v)}

      <section className={styles.section}>
        <h2 className="label">People who asked for you</h2>
        <p>
          {report.askedFor === 0
            ? 'Nobody has suggested your business to Localites yet.'
            : `${report.askedFor.toLocaleString('en-CA')} ${report.askedFor === 1 ? 'person' : 'people'} suggested your business to Localites.`}
        </p>
      </section>

      {report.category && (
        <section className={styles.section}>
          <h2 className="label">Interest in {report.category.browsedName}</h2>
          <p>{`Times people browsed ${report.category.browsedName}${report.category.browsedName !== report.category.name ? ` (which includes ${report.category.name})` : ''}: ${report.category.browsed.toLocaleString('en-CA')}.`}</p>
          {report.category.comparison ? (
            <p>
              Average for {report.category.name}: {report.category.comparison.average.toLocaleString('en-CA')} page opens. You:{' '}
              {ordinal(report.category.comparison.rank)} of {report.category.comparison.businesses}.
            </p>
          ) : (
            <p className="muted">Not enough {report.category.name} businesses on Localites yet to compare fairly.</p>
          )}
        </section>
      )}

      <p className="muted">
        Photos opened, and taps on your email, social media, directions and share buttons, will show here once your page has
        them.
      </p>
    </>
  );
}
