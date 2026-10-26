import { data, Form, Link, redirect, useNavigation, useSearchParams } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { SiteHeader } from '@/components/SiteHeader';
import { APPROXIMATE, readAddressForm, streetLine } from '@/lib/address';
import { pageMeta } from '@/lib/meta';
import { AddressRefused, addressPage, saveOwnerAddress } from '@/server/address.server';
import { refuseTeamMember } from '@/server/bookings.server';
import { checkLanguage } from '@/server/moderation.server';
import { alertTeam } from '@/server/owner-listing.server';
import type { Route } from './+types/business-address';

/**
 * A business's address (D-56, migration 0054), set by its owner or a manager: the street and
 * number, or the street only with the number hidden (never shown on Localites; the pin is then
 * near the street, marked approximate). Checked in the database on every request; recorded like
 * any owner change, so our team is told and can undo it.
 */
export const meta: Route.MetaFunction = ({ loaderData }) => [
  ...pageMeta(loaderData ? `The address of ${loaderData.name}` : 'Your business’s address'),
  { name: 'robots', content: 'noindex' },
];

export async function loader({ params, context }: Route.LoaderArgs) {
  const member = context.get(memberContext);
  const { env } = context.get(cloudflareContext);
  const page = await addressPage(env, member.userId, params.slug);
  if (!page) {
    await refuseTeamMember(env, member.userId, params.slug);
    throw data(null, { status: 404 });
  }
  return page;
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const member = context.get(memberContext);
  const form = await request.formData();
  const typed = {
    street: String(form.get('street') ?? '').slice(0, 200),
    number: String(form.get('number') ?? '').slice(0, 20),
    unit: String(form.get('unit') ?? '').slice(0, 40),
  };
  const read = readAddressForm(form);
  if ('error' in read) return data({ error: read.error, typed }, { status: 400 });
  if (!(await addressPage(env, member.userId, params.slug))) throw data(null, { status: 404 });
  if (env.OWNER_EDIT_LIMIT && !(await env.OWNER_EDIT_LIMIT.limit({ key: member.userId })).success) {
    return data({ error: 'That’s a lot of saves in a minute. Please wait a moment, then try again.', typed }, { status: 429 });
  }
  if (read.value.street && (await checkLanguage(env, [read.value.street])).flagged) {
    return data({ error: 'We can’t use that street name as it is. Email supportlocalites@gmail.com if it’s right.', typed }, { status: 400 });
  }
  try {
    const saved = await saveOwnerAddress(env, member.userId, params.slug, read.value);
    if (saved === 'unchanged') return redirect(`/vendors/${params.slug}/address?unchanged=1`);
    ctx.waitUntil(
      alertTeam(env, saved.auditId, new URL(request.url).origin).catch((err) =>
        console.error('owner alert not sent', err instanceof Error ? err.message : err),
      ),
    );
    return redirect(`/vendors/${params.slug}/address?saved=1`);
  } catch (err) {
    if (err instanceof AddressRefused) {
      if (err.message === 'not found') throw data(null, { status: 404 });
      return data({ error: err.message, typed }, { status: 409 });
    }
    throw err;
  }
}

export default function BusinessAddress({ loaderData, actionData }: Route.ComponentProps) {
  const { slug, name, town, address } = loaderData;
  const busy = useNavigation().state !== 'idle';
  const [params] = useSearchParams();
  const line = streetLine(address);
  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <p>
          <Link to={`/vendors/${slug}/edit`} className="text-link">
            ← Edit your listing
          </Link>
        </p>
        <h1 className="title-1">Your address</h1>
        <div className="title-rule" aria-hidden="true" />
        <p>
          {line ? `${name} shows as ${line}, ${town}.` : `${name} shows only its town, ${town}, and isn’t on the map.`}{' '}
          {address.lat === null
            ? line
              ? 'We couldn’t find it on the map, so it’s listed by its town.'
              : ''
            : address.approximate
              ? `Its pin is near the street, marked “${APPROXIMATE}”.`
              : 'Its pin is at the address.'}
        </p>
        {params.has('saved') && (
          <p className="notice" role="status">
            Saved. Visitors see it now.
          </p>
        )}
        {params.has('unchanged') && (
          <p className="notice" role="status">
            Nothing to save: that’s the address already.
          </p>
        )}
        <Form method="post" className="section-gap">
          <div className="field">
            <label htmlFor="street" className="field-label">
              Street
            </label>
            <input
              id="street"
              name="street"
              className="input"
              maxLength={120}
              autoComplete="address-line1"
              defaultValue={actionData?.typed.street ?? address.street ?? ''}
              placeholder="Like Lakeshore Road"
            />
          </div>
          <div className="field">
            <label htmlFor="number" className="field-label">
              Number (optional)
            </label>
            <input
              id="number"
              name="number"
              className="input"
              maxLength={13}
              inputMode="text"
              defaultValue={actionData?.typed.number ?? address.number ?? ''}
              placeholder="Like 22"
            />
          </div>
          <div className="field">
            <label htmlFor="unit" className="field-label">
              Unit or suite (optional)
            </label>
            <input
              id="unit"
              name="unit"
              className="input"
              maxLength={30}
              autoComplete="address-line2"
              defaultValue={actionData?.typed.unit ?? address.unit ?? ''}
              placeholder="Like 2B or Suite 200"
            />
          </div>
          <label className="field-hint">
            <input type="checkbox" name="hideNumber" value="yes" defaultChecked={address.hidden} /> Hide my street number and unit. Only the
            street and town show, and the pin is near the street, marked “{APPROXIMATE}”. They’re then never shown on Localites and we
            stop keeping them; share them in a message when you’re ready.
          </label>
          {actionData?.error && (
            <p className="field-error" role="alert">
              {actionData.error}
            </p>
          )}
          <p className="muted">
            {`The town, ${town}, is set by our team. Leave the street empty to show only the town. The pin comes from OpenStreetMap’s free address search; our team sees each change and can put the earlier address back.`}
          </p>
          <p className="section-gap">
            <button type="submit" className="button button-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save the address'}
            </button>
          </p>
        </Form>
      </main>
    </>
  );
}
