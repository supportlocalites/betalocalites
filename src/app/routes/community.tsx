import { useMemo, useState } from 'react';
import { data, Form, Link, useSearchParams } from 'react-router';
import { cloudflareContext } from '@/app/context';
import { TopBar } from '@/components/TopBar';
import { answersWords, COMMUNITY_LIMITS, communityDate, problemWords } from '@/lib/community-terms';
import { shareMeta } from '@/lib/meta';
import { hasSessionCookie, signedInUserId } from '@/server/auth/session.server';
import { communityFeed, communityKinds } from '@/server/community.server';
import type { Route } from './+types/community';
import styles from './community.module.css';

/**
 * Community (D-62) in the feed look the owner chose (A): questions about local businesses, each
 * with its most helpful answer, newest first; narrowed by kind of business. Anyone can read it;
 * people signed in ask (at /community/ask) and answer (on the question's page).
 */
export const meta: Route.MetaFunction = ({ matches }) =>
  shareMeta(matches, '/community', 'Community', 'Questions and answers from people near you, about local businesses.');

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const userId = hasSessionCookie(request) ? await signedInUserId(request, env) : null;
  const kind = new URL(request.url).searchParams.get('kind');
  const kinds = await communityKinds(env);
  const chosen = kinds.find((k) => k.slug === kind) ?? null;
  const page = { signedIn: Boolean(userId), kinds, kind: chosen?.slug ?? null, questions: await communityFeed(env, userId, chosen?.slug ?? null) };
  // Signed in, the page has their own held posts: never kept by a shared cache.
  return data(page, hasSessionCookie(request) ? { headers: { 'Cache-Control': 'private, no-store' } } : undefined);
}

export const headers: Route.HeadersFunction = ({ loaderHeaders }) => loaderHeaders;

/** Words of four letters or more, to spot a question already asked while typing a new one. */
const keyWords = (text: string) => new Set(text.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4));

export default function Community({ loaderData: { signedIn, kinds, kind, questions } }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const [draft, setDraft] = useState('');
  // Similar questions shown while asking (the owner: "similar questions shown while asking"), and
  // moved to the top of the list below (27 October 2026: "populate to the top similar questions to
  // see if they have already been answered").
  const { similar, listed } = useMemo(() => {
    const mine = keyWords(draft);
    if (mine.size === 0) return { similar: [], listed: questions };
    const scored = questions.map((q) => ({ q, shared: [...keyWords(q.title)].filter((w) => mine.has(w)).length }));
    const alike = scored
      .filter((x) => x.shared >= Math.min(2, mine.size))
      .sort((a, b) => b.shared - a.shared || b.q.answers - a.q.answers)
      .map((x) => x.q);
    const ids = new Set(alike.map((q) => q.id));
    return { similar: alike.slice(0, 3), listed: [...alike, ...questions.filter((q) => !ids.has(q.id))] };
  }, [draft, questions]);
  const alikeIds = new Set(similar.map((q) => q.id));
  return (
    <>
      <TopBar />
      <main className={styles.feed}>
        <div className={styles.head}>
          <h1 className={styles.title}>Community</h1>
          <span className={styles.meta}>Questions and answers from people near you</span>
        </div>
        {params.get('asked') === 'held' && (
          <p className="notice" role="status">
            Thanks. Your question is waiting for our team to look at it before others can see it.
          </p>
        )}
        {problemWords(params.get('problem')) && (
          <p className="notice" role="alert">
            {problemWords(params.get('problem'))}
          </p>
        )}
        {params.get('removed') === '1' && (
          <p className="notice" role="status">
            Your question is taken down.
          </p>
        )}

        {signedIn ? (
          <Form method="post" action="/community/ask" className={styles.ask}>
            <label htmlFor="title" className="visually-hidden">
              Your question
            </label>
            <div className={styles.askRow}>
              <input
                id="title"
                name="title"
                className="input"
                placeholder="Ask the community, like “Who does the best dinosaur cakes?”"
                minLength={COMMUNITY_LIMITS.title.min}
                maxLength={COMMUNITY_LIMITS.title.max}
                required
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                autoComplete="off"
              />
              <button type="submit" className="button button-primary">
                Ask
              </button>
            </div>
            {similar.length > 0 && (
              <div className={styles.similar} aria-live="polite">
                <strong>Already asked? Open one to vote or add yours:</strong>
                {similar.map((q) => (
                  <Link key={q.id} to={`/community/${q.id}`}>
                    {q.title} · {answersWords(q.answers)}
                  </Link>
                ))}
              </div>
            )}
            {/* The rest opens at the first letter (the owner, 27 October 2026: "as soon as someone types"). */}
            {draft.length > 0 && (
              <>
                <label htmlFor="kind" className="field-label">
                  About (optional)
                </label>
                <select id="kind" name="kind" className="input" defaultValue={kind ?? ''}>
                  <option value="">Any kind of business</option>
                  {kinds.map((k) => (
                    <option key={k.slug} value={k.slug}>
                      {k.name}
                    </option>
                  ))}
                </select>
                <label htmlFor="detail" className="field-label">
                  More detail (optional)
                </label>
                <textarea id="detail" name="detail" className="input" maxLength={COMMUNITY_LIMITS.detail} />
              </>
            )}
            <p className={styles.small}>Questions are public, with your first name and last initial. Please don’t share private details.</p>
          </Form>
        ) : (
          <p className={styles.ask}>
            <span>
              <Link to={`/join?next=${encodeURIComponent('/community')}`} className="text-link">
                Sign in
              </Link>{' '}
              to ask a question, answer or vote. Anyone can read.
            </span>
          </p>
        )}

        <nav className={styles.kinds} aria-label="Kinds of business">
          <Link to="/community" className={`${styles.chip} ${!kind ? styles.chipOn : ''}`} aria-current={!kind ? 'true' : undefined}>
            All
          </Link>
          {kinds.map((k) => (
            <Link
              key={k.slug}
              to={`/community?kind=${k.slug}`}
              className={`${styles.chip} ${kind === k.slug ? styles.chipOn : ''}`}
              aria-current={kind === k.slug ? 'true' : undefined}
            >
              {k.name}
            </Link>
          ))}
        </nav>

        {listed.length === 0 ? (
          <p className={styles.empty}>{kind ? 'No questions about this kind of business yet.' : 'No questions yet. Be the first to ask.'}</p>
        ) : (
          <ul className={styles.cards}>
            {listed.map((q) => (
              <li key={q.id}>
                <Link to={`/community/${q.id}`} className={styles.card}>
                  <span className={styles.meta}>
                    {alikeIds.has(q.id) && <span className={styles.alike}>Like yours</span>}
                    {q.kind && <span className={styles.tag}>{q.kind.name}</span>}
                    {q.held && <span className={styles.held}>Waiting for our team</span>}
                    {answersWords(q.answers)} · {communityDate(q.createdAt)}
                  </span>
                  <span className={styles.cardTitle}>{q.title}</span>
                  {q.leader && (
                    <span className={styles.leader}>
                      <span>
                        <strong>{q.leader.business ?? 'Advice'}</strong> ·{' '}
                        {q.leader.up > 0 ? `most helpful, ${q.leader.up} ${q.leader.up === 1 ? 'vote' : 'votes'} up` : 'the first answer'}
                      </span>
                    </span>
                  )}
                  <span className={styles.meta}>Asked by {q.mine ? 'you' : q.author}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
