import { Fragment, useState } from 'react';
import { data, Form, Link, useSearchParams } from 'react-router';
import { cloudflareContext } from '@/app/context';
import { PhotoPicker, PostPhotos, usePhotoSubmit } from '@/components/CommunityPhotos';
import { TopBar } from '@/components/TopBar';
import { COMMUNITY_LIMITS, communityDate, problemWords } from '@/lib/community-terms';
import { pageMeta } from '@/lib/meta';
import { hasSessionCookie, signedInUserId } from '@/server/auth/session.server';
import { communityPhotosOn } from '@/server/community-photos.server';
import { businessChoices, communityQuestion } from '@/server/community.server';
import type { Route } from './+types/community-question';
import styles from './community.module.css';

/**
 * One Community question (D-62): its answers, the most helpful first (or newest), each with up and
 * down votes; an answer can suggest a business on Localites (their favourites first, then search,
 * or type its name) or just give advice. Anyone can read; changes go to /community/:id/act, which
 * needs an account.
 */
export const meta: Route.MetaFunction = ({ loaderData }) => pageMeta(loaderData ? loaderData.question.title : 'Community');

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const userId = hasSessionCookie(request) ? await signedInUserId(request, env) : null;
  const order = new URL(request.url).searchParams.get('sort') === 'newest' ? 'newest' : 'helpful';
  const question = await communityQuestion(env, userId, params.id, order);
  if (!question) throw data(null, { status: 404 });
  const page = {
    signedIn: Boolean(userId),
    order,
    question,
    choices: userId && !question.held ? await businessChoices(env, userId) : null,
    photosOn: communityPhotosOn(env),
  };
  // Signed in, the page has their own votes and held posts: never kept by a shared cache.
  return data(page, hasSessionCookie(request) ? { headers: { 'Cache-Control': 'private, no-store' } } : undefined);
}

export const headers: Route.HeadersFunction = ({ loaderHeaders }) => loaderHeaders;

const ARROW = { up: 'M12 19V5M6 11l6-6 6 6', down: 'M12 5v14M6 13l6 6 6-6' } as const;

export default function CommunityQuestion({ loaderData: { signedIn, order, question: q, choices, photosOn } }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const [composing, setComposing] = useState(params.get('answer') === '1');
  const [mode, setMode] = useState<'business' | 'advice'>('business');
  const here = `/community/${q.id}`;
  const join = `/join?next=${encodeURIComponent(here)}`;
  const problem = problemWords(params.get('problem'));
  const photos = usePhotoSubmit(`/community/${q.id}/act`);
  return (
    <>
      <TopBar />
      <main className={styles.feed}>
        <p>
          <Link to="/community" className="text-link">
            ← Community
          </Link>
        </p>
        <article className={styles.question} aria-labelledby="q-title">
          <span className={styles.meta}>
            {q.kind && <span className={styles.tag}>{q.kind.name}</span>}
            {q.held && <span className={styles.held}>Waiting for our team: only you can see it</span>}
          </span>
          <h1 id="q-title" className={styles.qTitle}>
            {q.title}
          </h1>
          {q.detail && <p className={styles.detail}>{q.detail}</p>}
          <PostPhotos photos={q.photos} />
          <span className={styles.meta}>
            Asked by {q.mine ? 'you' : q.author} · {communityDate(q.createdAt)}
            {q.mine && (
              <Form method="post" action={`${here}/act`}>
                <input type="hidden" name="intent" value="remove-question" />
                <button type="submit" className={styles.textButton}>
                  Take down my question
                </button>
              </Form>
            )}
            {signedIn && !q.mine && !q.held && (
              <Link to={`${here}/report`} className={styles.textButton}>
                Report
              </Link>
            )}
          </span>
        </article>

        {params.get('photos') === 'waiting' && (
          <p className="notice" role="status">
            Thanks. Your photos are waiting for our team to look at them; until then only you can see them.
          </p>
        )}
        {params.get('posted') === 'held' && (
          <p className="notice" role="status">
            Thanks. Your answer is waiting for our team to look at it before others can see it.
          </p>
        )}
        {problem && (
          <p className="notice" role="alert">
            {problem}
          </p>
        )}

        {!q.held && (
          <div className={styles.bar}>
            <nav className={styles.seg} aria-label="Order of the answers">
              <Link to="?" aria-current={order === 'helpful' ? 'true' : undefined} preventScrollReset>
                Most helpful
              </Link>
              <Link to="?sort=newest" aria-current={order === 'newest' ? 'true' : undefined} preventScrollReset>
                Newest
              </Link>
            </nav>
            {signedIn ? (
              !composing && (
                <button type="button" className="button button-primary" onClick={() => setComposing(true)}>
                  Answer
                </button>
              )
            ) : (
              <Link to={join} className="button button-primary">
                Sign in to answer
              </Link>
            )}
          </div>
        )}

        {composing && choices && (
          <Form method="post" action={`${here}/act`} encType="multipart/form-data" onSubmit={photos.onSubmit} className={styles.composer}>
            <input type="hidden" name="intent" value="answer" />
            <fieldset>
              <legend>Your answer</legend>
              <div className={styles.modes}>
                <label className={styles.mode}>
                  <input type="radio" name="mode" value="business" checked={mode === 'business'} onChange={() => setMode('business')} />
                  Suggest a business
                </label>
                <label className={styles.mode}>
                  <input type="radio" name="mode" value="advice" checked={mode === 'advice'} onChange={() => setMode('advice')} />
                  Just answer
                </label>
              </div>
            </fieldset>
            {mode === 'business' && (
              <>
                {choices.favourites.length > 0 && (
                  <fieldset>
                    <legend className="field-label">Your favourites</legend>
                    <div className={styles.picks}>
                      {choices.favourites.map((b) => (
                        <label key={b.slug} className={styles.pick}>
                          <input type="radio" name="vendor" value={b.slug} />
                          <span>
                            {b.name}
                            {b.kind && <span className="muted"> · {b.kind}</span>}
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                )}
                <label htmlFor="find" className="field-label">
                  {choices.favourites.length > 0 ? 'Or search Localites' : 'Search Localites'}
                </label>
                <input id="find" name="find" className="input" list="businesses" autoComplete="off" placeholder="Start typing a business’s name" />
                <datalist id="businesses">
                  {choices.all.map((b) => (
                    <option key={b.slug} value={b.name} />
                  ))}
                </datalist>
              </>
            )}
            <label htmlFor="body" className="field-label">
              {mode === 'business' ? 'Why them?' : 'Your advice'}
            </label>
            <textarea
              id="body"
              name="body"
              className="input"
              required
              minLength={COMMUNITY_LIMITS.body.min}
              maxLength={COMMUNITY_LIMITS.body.max}
              placeholder={mode === 'business' ? 'What did they do for you, and how was it?' : 'What would you tell a friend?'}
            />
            {photosOn && <PhotoPicker problem={photos.problem} />}
            <p className={styles.small}>Answers are public, with your first name and last initial. Please don’t share private details.</p>
            <div className={styles.bar}>
              <button type="button" className={styles.textButton} onClick={() => setComposing(false)}>
                Cancel
              </button>
              <button type="submit" className="button button-primary" disabled={photos.preparing}>
                {photos.preparing ? 'Getting photos ready…' : 'Post answer'}
              </button>
            </div>
          </Form>
        )}

        {q.answers.length === 0 ? (
          <p className={styles.empty}>{q.held ? '' : 'No answers yet.'}</p>
        ) : (
          <ol className={styles.answers} aria-label="Answers">
            {q.answers.map((a, i) => {
              const top = order === 'helpful' && i === 0 && a.up > 0 && !a.held;
              return (
                <li key={a.id} id={`a-${a.id}`} className={`${styles.answer} ${top ? styles.answerTop : ''}`}>
                  <div className={styles.votes}>
                    {(['up', 'down'] as const).map((way) => {
                      const on = a.myVote === (way === 'up' ? 1 : -1);
                      const button = (
                        <button
                          type="submit"
                          className={`${styles.vote} ${on ? styles.voteOn : ''}`}
                          aria-pressed={on}
                          aria-label={way === 'up' ? 'Vote up' : 'Vote down'}
                          disabled={a.mine || a.held}
                          title={a.mine ? 'You can’t vote on your own answer' : undefined}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                            <path d={ARROW[way]} />
                          </svg>
                        </button>
                      );
                      const form = signedIn ? (
                        <Form key={way} method="post" action={`${here}/act`} preventScrollReset>
                          <input type="hidden" name="intent" value="vote" />
                          <input type="hidden" name="answer" value={a.id} />
                          <input type="hidden" name="value" value={way === 'up' ? '1' : '-1'} />
                          {button}
                        </Form>
                      ) : (
                        <Link key={way} to={join} className={styles.vote} aria-label={`Sign in to vote ${way}`}>
                          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                            <path d={ARROW[way]} />
                          </svg>
                        </Link>
                      );
                      return way === 'up' ? (
                        <Fragment key={way}>
                          {form}
                          <span className={styles.count} aria-label={`${a.up} ${a.up === 1 ? 'vote' : 'votes'} up`}>
                            {a.up}
                          </span>
                        </Fragment>
                      ) : (
                        form
                      );
                    })}
                  </div>
                  <div className={styles.main}>
                    {top && <span className={styles.best}>Most helpful</span>}
                    {a.held && <span className={styles.held}>Waiting for our team: only you can see it</span>}
                    {a.business ? (
                      <Link to={`/vendors/${a.business.slug}`} className={styles.business}>
                        {a.business.photo ? <img src={a.business.photo} alt="" className={styles.thumb} /> : <span className={styles.thumb} />}
                        <span className={styles.businessWords}>
                          <span className={styles.businessName}>{a.business.name}</span>
                          <span className="muted">{a.business.kind ? `${a.business.kind} · on Localites` : 'On Localites'}</span>
                        </span>
                        <Suggested n={a.suggested} />
                      </Link>
                    ) : (
                      a.businessName && (
                        <span className={styles.business}>
                          <span className={styles.thumb} />
                          <span className={styles.businessWords}>
                            <span className={styles.businessName}>{a.businessName}</span>
                            <span className="muted">Not on Localites yet</span>
                          </span>
                          <Suggested n={a.suggested} />
                        </span>
                      )
                    )}
                    <p className={styles.body}>{a.body}</p>
                    <PostPhotos photos={a.photos} />
                    <span className={styles.foot}>
                      <span>{a.mine ? 'You' : a.author}</span>
                      <span>{communityDate(a.createdAt)}</span>
                      {a.down > 0 && <span>{`${a.down} disagree`}</span>}
                      {a.mine ? (
                        <Form method="post" action={`${here}/act`}>
                          <input type="hidden" name="intent" value="remove-answer" />
                          <input type="hidden" name="answer" value={a.id} />
                          <button type="submit" className={styles.textButton}>
                            Take down my answer
                          </button>
                        </Form>
                      ) : (
                        signedIn &&
                        !a.held && (
                          <Link to={`${here}/report?answer=${a.id}`} className={styles.textButton}>
                            Report
                          </Link>
                        )
                      )}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </main>
    </>
  );
}

/**
 * How many people suggested this business on this question, beside its name (the owner, 27 October
 * 2026, mock-up 1A: each answer its own, "note to the right of the vendor name how many times they
 * were suggested in the thread"). Only answers showing to everyone count.
 */
function Suggested({ n }: { n: number }) {
  if (n < 1) return null;
  return <span className={styles.suggested}>{`Suggested by ${n} ${n === 1 ? 'person' : 'people'}`}</span>;
}
