import { data, Form, Link, redirect, useNavigation, useSearchParams } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { SideSwitch } from '@/components/SideSwitch';
import { SiteHeader } from '@/components/SiteHeader';
import { SLUG } from '@/lib/ids.mjs';
import { pageMeta } from '@/lib/meta';
import { TOO_FAST } from '@/lib/plan-terms';
import { savedVendors, unsaveVendor } from '@/server/events.server';
import { refusal, tooFast } from '@/server/plan-pages.server';
import type { Route } from './+types/saved';
import { SquarePhoto } from '@/components/SquarePhoto';
import styles from './plan.module.css';

/** Screen C6: the person's saved businesses. Private: businesses aren't told (B §4). */
export const meta: Route.MetaFunction = () => [...pageMeta('Saved businesses'), { name: 'robots', content: 'noindex' }];

export async function loader({ context }: Route.LoaderArgs) {
  const member = context.get(memberContext);
  return savedVendors(context.get(cloudflareContext).env, member.userId);
}

export async function action({ request, context }: Route.ActionArgs) {
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  const form = await request.formData();
  const slug = String(form.get('slug') ?? '');
  if (form.get('intent') !== 'unsave' || !SLUG.test(slug)) throw data(null, { status: 400 });
  if (await tooFast(env, member.userId)) return data({ error: TOO_FAST }, { status: 429 });
  try {
    await unsaveVendor(env, member.userId, slug);
  } catch (err) {
    const { error, status } = refusal(err);
    return data({ error }, { status });
  }
  return redirect('/saved?removed=1');
}

export default function Saved({ loaderData, actionData }: Route.ComponentProps) {
  const { saved, onTeam } = loaderData;
  const busy = useNavigation().state !== 'idle';
  const removed = useSearchParams()[0].has('removed') && !actionData;
  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        {onTeam && <SideSwitch current="events" />}
        <h1 className="title-1">Saved businesses</h1>
        <div className="title-rule" aria-hidden="true" />
        {actionData?.error && (
          <p className="notice" role="alert">
            {actionData.error}
          </p>
        )}
        {removed && (
          <p className="notice" role="status">
            Removed from your saved businesses.
          </p>
        )}
        <p className="muted">Only you can see this list. Businesses aren’t told when you save them.</p>
        {saved.length === 0 ? (
          <p>Nothing saved yet. Tap Save on any business’s page to keep it here.</p>
        ) : (
          <ul className={styles.list}>
            {saved.map((s) => (
              <li key={s.slug} className={styles.withPhoto}>
                <SquarePhoto photo={s.photo} alt="" />
                <div className={styles.rowBody}>
                  <span className={styles.name}>{s.listed ? <Link to={`/vendors/${s.slug}`}>{s.name}</Link> : s.name}</span>
                  <span className={styles.meta}>{[s.category, s.town].filter(Boolean).join(' · ')}</span>
                  {!s.listed && <span className={styles.meta}>No longer listed</span>}
                  <div className={styles.rowActions}>
                    {s.listed && (
                      <Link to={`/vendors/${s.slug}/add`} className="text-link">
                        Add to event
                      </Link>
                    )}
                    <Form method="post">
                      <input type="hidden" name="intent" value="unsave" />
                      <input type="hidden" name="slug" value={s.slug} />
                      <button type="submit" className={styles.textButton} disabled={busy}>
                        Remove
                      </button>
                    </Form>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="section-gap">
          <Link to="/events" className="text-link">
            My events
          </Link>
        </p>
      </main>
    </>
  );
}
