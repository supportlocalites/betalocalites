import { data, Form, Link, redirect, useNavigation, useSearchParams } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { NameFields, ProfileFields } from '@/components/ProfileFields';
import { SiteHeader } from '@/components/SiteHeader';
import { businessHome } from '@/components/TopBar';
import { pageMeta } from '@/lib/meta';
import { type TeamBusiness, updateDetails, updateNames, updatePerson } from '@/server/auth/member.server';
import { NAME_WORDS, NAMES_NEEDED, namesInput, profileInput } from '@/server/member-input';
import { listMatches } from '@/server/moderation.server';
import { getProfile } from '@/server/profile.server';
import { myOwnRequests } from '@/server/business-requests.server';
import { myAccount } from '@/server/claims.server';
import { reviewRequestsOn, setReviewRequests } from '@/server/review-requests.server';
import { REVIEW_REQUESTS } from '@/lib/review-terms';
import type { Route } from './+types/account';
import styles from './account.module.css';

/**
 * Screens A4, V1 and V5: Edit profile (D-29; Style C, D-63). One login for personal use
 * and the businesses a person manages. Only ever shows this person's own details,
 * businesses and claims.
 */
export const meta: Route.MetaFunction = () => [...pageMeta('Edit profile'), { name: 'robots', content: 'noindex' }];

export async function loader({ context }: Route.LoaderArgs) {
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  const [{ businesses, claims }, profile, added, reviewRequests] = await Promise.all([
    myAccount(env, member.userId),
    getProfile(env, member.userId),
    myOwnRequests(env, member.userId),
    reviewRequestsOn(env, member.userId),
  ]);
  // Accounts made before first and last names were asked (the team's) start with the
  // whole name in the first box.
  const first = member.firstName ?? member.name;
  return { first, last: member.lastName, email: member.email, profile, businesses, claims, added, reviewRequests };
}

export async function action({ request, context }: Route.ActionArgs) {
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  const form = await request.formData();
  const intent = String(form.get('intent') ?? '');
  if (intent === 'emails') {
    // Only this person's own choice (on the Privacy part).
    await setReviewRequests(env, member.userId, form.get('reviewRequests') === 'on');
    return redirect('/account?tab=privacy&emails=1');
  }
  if (intent !== 'details' && intent !== 'names' && intent !== 'about') throw data(null, { status: 400 });
  const fields = Object.fromEntries(form);
  const names = intent === 'about' ? null : namesInput.safeParse(fields);
  const profile = intent === 'names' ? null : profileInput.safeParse(fields);
  if ((names && !names.success) || (profile && !profile.success)) {
    const errors: Record<string, string> = {};
    for (const issue of [...(names?.error?.issues ?? []), ...(profile?.error?.issues ?? [])]) errors[String(issue.path[0])] ??= issue.message;
    const nameMissing = names !== null && (!String(fields.firstName ?? '').trim() || !String(fields.lastName ?? '').trim());
    return data({ error: nameMissing ? NAMES_NEEDED : 'Please check what’s marked below.', errors, tab: intent }, { status: 400 });
  }
  // Names show on reviews and to businesses: the language check's word list runs on them too,
  // on a part being changed only, so someone whose real name is on the list can still save the
  // rest of their details (independent review).
  if (names?.success) {
    const changed = [names.data.firstName, names.data.lastName].filter((n, i) => n !== [member.firstName, member.lastName][i]);
    if (listMatches(changed).length > 0) {
      return data({ error: NAME_WORDS, errors: { firstName: NAME_WORDS }, tab: intent }, { status: 400 });
    }
  }
  // Only ever this person's own record: the id comes from the session, never the form.
  if (intent === 'names' && names?.success) {
    await updateNames(env, member.userId, names.data);
    return redirect('/account?saved=1');
  }
  if (intent === 'about' && profile?.success) {
    await updateDetails(env, member.userId, profile.data);
    return redirect('/account?tab=about&saved=1');
  }
  // The older form with everything at once (kept for anything still sending it).
  if (names?.success && profile?.success) {
    await updatePerson(env, member.userId, names.data, profile.data);
    return redirect('/account?saved=1');
  }
  throw data(null, { status: 400 });
}

const when = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeZone: 'America/Toronto' });
const CLAIM_STATUS = {
  submitted: 'Waiting for our team',
  approved: 'Approved',
  rejected: 'Not approved',
  withdrawn: 'Withdrawn',
} as const;
const ROLE = { owner: 'Owner', manager: 'Manager', staff: 'Staff' } as Record<string, string>;
const TABS = [
  ['profile', 'Profile'],
  ['about', 'About you'],
  ['businesses', 'Businesses'],
  ['privacy', 'Privacy'],
] as const;
type Tab = (typeof TABS)[number][0];
const tabOf = (v: string | null | undefined): Tab => (TABS.some(([k]) => k === v) ? (v as Tab) : 'profile');

/**
 * Edit profile in Style C (D-63): tabs at the side (along the top on a phone) for Profile, About
 * you, Businesses and Privacy; one part shown at a time (all four are in the page, so it works
 * without scripts too). Only ever this person's own details, businesses and claims.
 */
export default function Account({ loaderData, actionData }: Route.ComponentProps) {
  const { first, last, email, profile, businesses, claims, added, reviewRequests } = loaderData;
  const busy = useNavigation().state !== 'idle';
  const [params] = useSearchParams();
  const tab = tabOf(actionData?.tab === 'about' ? 'about' : actionData?.tab ? 'profile' : params.get('tab'));
  const saved = params.has('saved') && !actionData;
  const errors = actionData?.errors ?? {};
  const initials = `${(first ?? '').trim().charAt(0)}${(last ?? '').trim().charAt(0)}`.toUpperCase();
  const notice = (here: Tab) =>
    tab === here && (
      <>
        {actionData?.error && (
          <p className="notice" role="alert">
            {actionData.error}
          </p>
        )}
        {saved && (
          <p className={styles.saved} role="status">
            Saved
          </p>
        )}
      </>
    );
  const open = businesses.filter((b) => !b.archived);
  return (
    <>
      <SiteHeader />
      <main className={`page ${styles.page}`}>
        <div className={styles.side}>
          <div className={styles.who}>
            <span className={styles.avatar} aria-hidden="true">
              {initials}
            </span>
            <span>
              <span className={styles.whoName}>{`${first ?? ''} ${last ?? ''}`.trim()}</span>
              <h1 className={styles.whoTitle}>Edit profile</h1>
            </span>
          </div>
          <nav aria-label="Edit profile" className={styles.tabs}>
            {TABS.map(([k, label]) => (
              <Link
                key={k}
                to={k === 'profile' ? '/account' : `/account?tab=${k}`}
                className={`${styles.tab} ${tab === k ? styles.tabOn : ''}`}
                aria-current={tab === k ? 'page' : undefined}
                preventScrollReset
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>

        <div className={styles.main}>
          <section aria-labelledby="profile-title" className={styles.panel} hidden={tab !== 'profile'}>
            <h2 id="profile-title" className={styles.panelTitle}>
              Profile
            </h2>
            <p className={styles.panelHint}>How businesses see you when you message them.</p>
            {notice('profile')}
            <Form method="post" noValidate className={styles.form}>
              <input type="hidden" name="intent" value="names" />
              <NameFields first={first} last={last} errors={tab === 'profile' ? errors : {}} />
              <div className={styles.email}>
                <span className="field-label">Email</span>
                <span className={styles.emailRow}>
                  <strong>{email}</strong>
                  <span className={styles.pill}>Sign-in codes go here</span>
                </span>
              </div>
              <p>
                <button type="submit" className="button button-primary" disabled={busy}>
                  Save changes
                </button>
              </p>
            </Form>
          </section>

          <section aria-labelledby="about-title" className={styles.panel} hidden={tab !== 'about'}>
            <h2 id="about-title" className={styles.panelTitle}>
              About you
            </h2>
            <p className={styles.panelHint}>Optional, and never shown to businesses.</p>
            {notice('about')}
            <Form method="post" noValidate className={styles.form}>
              <input type="hidden" name="intent" value="about" />
              <ProfileFields values={profile} errors={tab === 'about' ? errors : {}} />
              <p>
                <button type="submit" className="button button-primary" disabled={busy}>
                  Save changes
                </button>
              </p>
            </Form>
          </section>

          <section aria-labelledby="businesses-title" className={styles.panel} hidden={tab !== 'businesses'}>
            <h2 id="businesses-title" className={styles.panelTitle}>
              Businesses
            </h2>
            <p className={styles.panelHint}>
              {businesses.length > 0 ? 'Businesses you run. Switch to one from the menu at the top right.' : 'Run a local business? Connect it to your account.'}
            </p>
            {businesses.length > 0 && (
              <ul className={styles.rows}>
                {businesses.map((b) => (
                  <li key={b.id} className={styles.row}>
                    <span className={styles.rowWords}>
                      {b.listed ? (
                        <Link to={`/vendors/${b.slug}`} className={styles.rowName}>
                          {b.name}
                        </Link>
                      ) : (
                        <span className={styles.rowName}>{b.name}</span>
                      )}
                      <span className={styles.rowMeta}>
                        {b.archived ? 'No longer on Localites. Email supportlocalites@gmail.com with questions.' : `${ROLE[b.role] ?? b.role} · ${b.listed ? 'Listed' : 'Not listed at the moment'}`}
                      </span>
                      {!b.archived && (
                        <span className={styles.rowLinks}>
                          <Link to={`/vendors/${b.slug}/messages`}>Inbox</Link>
                          {(b.role === 'owner' || b.role === 'manager') && (
                            <>
                              <Link to={`/vendors/${b.slug}/edit`}>Listing</Link>
                              <Link to={`/vendors/${b.slug}/photos`}>Photos</Link>
                              {b.analytics && <Link to={`/vendors/${b.slug}/analytics`}>Analytics</Link>}
                            </>
                          )}
                          {b.role === 'owner' && <Link to={`/vendors/${b.slug}/team`}>Team</Link>}
                          {b.role === 'owner' && (
                            <Link to={`/vendors/${b.slug}/remove`} className={styles.danger}>
                              Remove from Localites…
                            </Link>
                          )}
                        </span>
                      )}
                    </span>
                    {!b.archived && (
                      <Link to={businessHome({ slug: b.slug, name: b.name, role: b.role as TeamBusiness['role'], analytics: b.analytics })} className={styles.pillButton}>
                        Switch to it
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {params.has('added') && (
              <p className="notice" role="status">
                Thanks. Our team will be in touch to confirm your business, then list it with you.
              </p>
            )}
            {added.length > 0 && (
              <ul className={styles.rows} aria-label="Businesses you added">
                {added.map((a) => (
                  <li key={a.id} className={styles.row}>
                    <span className={styles.rowWords}>
                      <span className={styles.rowName}>{a.business}</span>
                      <span className={styles.rowMeta}>
                        {a.status === 'new'
                          ? `You added it · ${when.format(new Date(a.createdAt))} · our team will be in touch`
                          : 'Our team couldn’t add it. Email supportlocalites@gmail.com with questions.'}
                      </span>
                    </span>
                    <span className={`${styles.pill} ${a.status === 'new' ? styles.pillWait : ''}`}>{a.status === 'new' ? 'With our team' : 'Not added'}</span>
                  </li>
                ))}
              </ul>
            )}
            {claims.length > 0 && (
              <ul className={styles.rows} aria-label="Your claims" id="claims">
                {claims.map((c) => (
                  <li key={c.id} className={styles.row}>
                    <span className={styles.rowWords}>
                      {c.listed ? (
                        <Link to={`/vendors/${c.slug}`} className={styles.rowName}>
                          {c.business}
                        </Link>
                      ) : (
                        <span className={styles.rowName}>{c.business}</span>
                      )}
                      <span className={styles.rowMeta}>{`Your claim · sent ${when.format(new Date(c.createdAt))}`}</span>
                      {c.reason && <span className={styles.rowMeta}>Reason: {c.reason}</span>}
                    </span>
                    <span className={`${styles.pill} ${c.status === 'approved' ? styles.pillOk : c.status === 'submitted' ? styles.pillWait : ''}`}>
                      {CLAIM_STATUS[c.status]}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {open.length === 0 ? (
              <div className={styles.choose}>
                <Link to="/account/claim" className={styles.choice}>
                  <span className={styles.choiceTitle}>Claim a business</span>
                  <span>It’s already on Localites. Find it and tell us it’s yours.</span>
                </Link>
                <Link to="/account/add-business" className={styles.choice}>
                  <span className={styles.choiceTitle}>Add my business</span>
                  <span>It isn’t on Localites yet. Give us the basics and we’ll set it up with you.</span>
                </Link>
              </div>
            ) : (
              <p className={styles.more}>
                <Link to="/account/claim">Claim another business</Link>
                <Link to="/account/add-business">Add another business</Link>
              </p>
            )}
            <p className={styles.panelHint}>Either way, our team confirms it with you before anything changes. It’s free.</p>
          </section>

          <section aria-labelledby="privacy-title" className={styles.panel} hidden={tab !== 'privacy'}>
            <h2 id="privacy-title" className={styles.panelTitle}>
              Privacy
            </h2>
            <p className={styles.panelHint}>Your emails, and your data.</p>
            <Form method="post" className={styles.form} id="emails">
              <input type="hidden" name="intent" value="emails" />
              <label className={styles.keep}>
                <input type="checkbox" name="reviewRequests" defaultChecked={reviewRequests} />
                <span>
                  <strong>{REVIEW_REQUESTS.label}</strong> {REVIEW_REQUESTS.hint}
                </span>
              </label>
              <p>
                <button type="submit" className={styles.pillButton} disabled={busy}>
                  Save email choice
                </button>
              </p>
              {params.has('emails') && (
                <p className={styles.saved} role="status">
                  Saved
                </p>
              )}
            </Form>
            <ul className={styles.rows}>
              <li className={styles.row}>
                <span className={styles.rowWords}>
                  <span className={styles.rowName}>Download your data</span>
                  <span className={styles.rowMeta}>Everything we keep about you, in a readable file.</span>
                </span>
                <Link to="/account/data" className={styles.pillButton}>
                  Download
                </Link>
              </li>
              <li className={styles.row}>
                <span className={styles.rowWords}>
                  <span className={styles.rowName}>Delete your account</span>
                  <span className={styles.rowMeta}>Erases your name, email and details, and your favourites and picks. This can’t be undone.</span>
                </span>
                <Link to="/account/delete" className={`${styles.pillButton} ${styles.danger}`}>
                  Delete…
                </Link>
              </li>
            </ul>
          </section>
        </div>
      </main>
    </>
  );
}
