import { data, Form, isRouteErrorResponse, Link, redirect, useNavigation, useRouteError } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { SiteHeader } from '@/components/SiteHeader';
import { TeamOnly, teamOnlyReason } from '@/components/TeamOnly';
import { NAME_CHANGE_DAYS, NAME_MAX } from '@/lib/business-name';
import { pageMeta } from '@/lib/meta';
import { refuseTeamMember } from '@/server/bookings.server';
import { NameRefused, namePage, readName, renameBusiness } from '@/server/business-name.server';
import { checkLanguage } from '@/server/moderation.server';
import { alertTeam } from '@/server/owner-listing.server';
import type { Route } from './+types/business-name';

/**
 * A business's owner changes its name (M20, D-54). Checked in the database on every request;
 * the language check reads the new name first. Managers are told only the owner can.
 */
export const meta: Route.MetaFunction = ({ loaderData }) => [
  ...pageMeta(loaderData ? `Change the name of ${loaderData.name}` : 'Change your business’s name'),
  { name: 'robots', content: 'noindex' },
];

export async function loader({ params, context }: Route.LoaderArgs) {
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  const page = await namePage(env, member.userId, params.slug);
  if (!page) {
    await refuseTeamMember(env, member.userId, params.slug);
    throw data(null, { status: 404 });
  }
  if ('renamedTo' in page) throw redirect(`/vendors/${page.renamedTo}/name`);
  return page;
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const member = context.get(memberContext);
  const form = await request.formData();
  const typed = String(form.get('name') ?? '').slice(0, 1000);
  const read = readName(typed);
  if ('error' in read) return data({ error: read.error, typed }, { status: 400 });
  // Who, first: the language check is only asked for the owner's own business.
  const page = await namePage(env, member.userId, params.slug);
  if (!page) throw data(null, { status: 404 });
  if (!('renamedTo' in page) && page.role !== 'owner') return data({ error: 'Only the business’s owner can change its name.', typed }, { status: 409 });
  if (env.OWNER_EDIT_LIMIT && !(await env.OWNER_EDIT_LIMIT.limit({ key: member.userId })).success) {
    return data({ error: 'That’s a lot of saves in a minute. Please wait a moment, then try again.', typed }, { status: 429 });
  }
  const check = await checkLanguage(env, [read.name]);
  if (check.flagged) {
    return data(
      { error: 'We can’t use that name as it is. If it really is your business’s name, email supportlocalites@gmail.com.', typed },
      { status: 400 },
    );
  }
  try {
    const renamed = await renameBusiness(env, member.userId, params.slug, read.name);
    // The team's "check now" email, after the owner sees it's done.
    ctx.waitUntil(
      alertTeam(env, renamed.auditId, new URL(request.url).origin).catch((err) =>
        console.error('owner alert not sent', err instanceof Error ? err.message : err),
      ),
    );
    return redirect(`/vendors/${renamed.slug}/edit?saved=${renamed.auditId}`);
  } catch (err) {
    if (err instanceof NameRefused) {
      if (err.message === 'not found') throw data(null, { status: 404 });
      return data({ error: err.message, typed }, { status: 409 });
    }
    throw err;
  }
}

const day = (at: string) => new Date(at).toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Toronto' });

export default function BusinessName({ loaderData, actionData }: Route.ComponentProps) {
  const { slug, name, role, former, nextChange } = loaderData;
  const busy = useNavigation().state !== 'idle';
  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <Link to={`/vendors/${slug}/edit`} className="text-link">
          Back to editing
        </Link>
        <h1 className="title-1">Your business’s name</h1>
        <div className="title-rule" aria-hidden="true" />
        <p>
          Today it’s <strong>{name}</strong>.
        </p>
        {role !== 'owner' ? (
          <p className="notice">Only the business’s owner can change its name.</p>
        ) : nextChange ? (
          <p className="notice">{`You changed the name recently. You can change it again from ${day(nextChange)}. If it needs fixing sooner, email supportlocalites@gmail.com.`}</p>
        ) : (
          <>
            <ul className="section-gap">
              <li>Your page’s web address changes to match. Old links to your page keep working.</li>
              <li>Everything on Localites shows the new name, including your customers’ earlier conversations, event plans and reviews.</li>
              <li>Emails already sent keep the old name.</li>
              <li>Our team sees the change and can put the old name back if it isn’t right.</li>
              <li>{`You can change the name once every ${NAME_CHANGE_DAYS} days.`}</li>
            </ul>
            <Form method="post" className="section-gap">
              <label htmlFor="name" className="field-label">
                New name
              </label>
              <input
                id="name"
                name="name"
                className="input"
                maxLength={NAME_MAX}
                defaultValue={actionData?.typed ?? ''}
                required
                aria-invalid={actionData?.error ? true : undefined}
                aria-describedby={actionData?.error ? 'name-error' : undefined}
              />
              {actionData?.error && (
                <p className="field-error" id="name-error">
                  {actionData.error}
                </p>
              )}
              <p className="section-gap">
                <button type="submit" className="button button-primary" disabled={busy}>
                  {busy ? 'Changing…' : 'Change the name'}
                </button>
              </p>
            </Form>
          </>
        )}
        {former.length > 0 && (
          <section className="section-gap">
            <h2 className="label">Earlier names</h2>
            <ul>
              {former.map((f) => (
                <li key={f.until}>{`${f.name}, until ${day(f.until)}`}</li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const teamOnly = teamOnlyReason(error);
  if (teamOnly) return <TeamOnly reason={teamOnly} />;
  const missing = isRouteErrorResponse(error) && error.status === 404;
  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <h1 className="title-1">{missing ? 'You can’t change this business’s name' : 'Something went wrong'}</h1>
        <div className="title-rule" aria-hidden="true" />
        <p className="muted">
          {missing
            ? 'Only the business’s owner on Localites can. If you think this should be yours, email supportlocalites@gmail.com.'
            : 'The page didn’t load. Please try again in a moment.'}
        </p>
        <Link to="/account" className="button button-primary">
          Your account
        </Link>
      </main>
    </>
  );
}
