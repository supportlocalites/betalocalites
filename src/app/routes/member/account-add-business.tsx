import { data, Form, Link, redirect, useNavigation } from 'react-router';
import { cloudflareContext, memberContext } from '@/app/context';
import { RelationshipChoice } from '@/components/RelationshipChoice';
import { SiteHeader } from '@/components/SiteHeader';
import { torontoDate } from '@/lib/activity';
import { APPROXIMATE, readAddressForm } from '@/lib/address';
import { pageMeta } from '@/lib/meta';
import { addOwnBusiness, kindOptions, notifyTeamOwn, ownTeamEmail, RequestRefused } from '@/server/business-requests.server';
import { ownBusinessInput } from '@/server/member-input';
import { connectionFingerprint } from '@/server/suggestions.server';
import { afterwards, formFields, siteUrl } from '@/server/plan-pages.server';
import { addressKey } from '@/server/visitor.server';
import type { Route } from './+types/account-add-business';
import styles from './account.module.css';

/**
 * Add my business (D-63): the basics, then our team gets in touch to confirm it's theirs and
 * lists it; listing it starts a claim for them, confirmed as any claim is. Free.
 */
export const meta: Route.MetaFunction = () => [...pageMeta('Add my business'), { name: 'robots', content: 'noindex' }];

export async function loader({ context }: Route.LoaderArgs) {
  return { kinds: await kindOptions(context.get(cloudflareContext).env) };
}

const TOO_MANY = 'That’s a lot of businesses in a few minutes. Please wait a little and try again.';

export async function action({ request, context }: Route.ActionArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const member = context.get(memberContext);
  const form = await request.formData();
  const typed = formFields(form);
  const errors: Record<string, string> = {};
  const parsed = ownBusinessInput.safeParse(typed);
  if (!parsed.success) for (const issue of parsed.error.issues) errors[String(issue.path[0])] ??= issue.message;
  const address = readAddressForm(form);
  if ('error' in address) errors[address.field] = address.error;
  if (!parsed.success || 'error' in address) {
    return data({ error: 'Please check what’s marked below.', errors, typed }, { status: 400 });
  }
  // A few a minute from one internet address, as Suggest a business (kept by Cloudflare, never stored).
  if (env.SUGGEST_LIMIT && !(await env.SUGGEST_LIMIT.limit({ key: addressKey(request) })).success) {
    return data({ error: TOO_MANY, errors, typed }, { status: 429 });
  }
  try {
    const connection = await connectionFingerprint(env, addressKey(request), torontoDate(new Date()));
    const id = await addOwnBusiness(env, member, parsed.data, address.value, connection);
    const kind = (await kindOptions(env)).find((k) => k.slug === parsed.data.category)?.name ?? null;
    afterwards(
      ctx,
      notifyTeamOwn(env, id, ownTeamEmail({ ...parsed.data, id, address: address.value, kind, person: { name: member.name, email: member.email } }, siteUrl(env, request))),
      'own business email',
    );
  } catch (err) {
    if (err instanceof RequestRefused) return data({ error: err.message, errors, typed }, { status: 409 });
    throw err;
  }
  return redirect('/account?tab=businesses&added=1');
}

export default function AddBusiness({ loaderData: { kinds }, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== 'idle';
  const errors: Record<string, string> = actionData?.errors ?? {};
  const typed: Record<string, string> = actionData?.typed ?? {};
  const groups = [...new Set(kinds.map((k) => k.group))];
  const err = (name: string) =>
    errors[name] ? (
      <p className="field-error" id={`${name}-error`}>
        {errors[name]}
      </p>
    ) : null;
  const described = (name: string, hint?: string) => [hint, errors[name] ? `${name}-error` : null].filter(Boolean).join(' ') || undefined;
  return (
    <>
      <SiteHeader />
      <main className={`page ${styles.narrow}`}>
        <p>
          <Link to="/account?tab=businesses" className="text-link">
            ← Businesses
          </Link>
        </p>
        <h1 className="title-1">Add my business</h1>
        <p className="muted">
          Tell us the basics. Our team will get in touch to confirm it’s yours, then list it and help you set up your page. It’s
          free, and nothing goes live until we’ve spoken.
        </p>
        {actionData?.error && (
          <p className="notice" role="alert">
            {actionData.error}
          </p>
        )}
        <Form method="post" noValidate className={styles.panel}>
          <h2 className={styles.panelTitle}>The business</h2>
          <div className="field">
            <label htmlFor="businessName" className="field-label">
              Its name
            </label>
            <input id="businessName" name="businessName" className="input" maxLength={200} required autoComplete="organization"
              defaultValue={typed.businessName ?? ''} aria-describedby={described('businessName')} />
            {err('businessName')}
          </div>
          <div className="field">
            <label htmlFor="category" className="field-label">
              What kind of business (optional)
            </label>
            <select id="category" name="category" className="input" defaultValue={typed.category ?? ''}>
              <option value="">Choose one</option>
              {groups.map((g) => (
                <optgroup key={g} label={g}>
                  {kinds
                    .filter((k) => k.group === g)
                    .map((k) => (
                      <option key={k.slug} value={k.slug}>
                        {k.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="website" className="field-label">
              Website or social page (optional)
            </label>
            <input id="website" name="website" className="input" maxLength={500} inputMode="url" placeholder="Like instagram.com/yourbusiness"
              defaultValue={typed.website ?? ''} aria-describedby={described('website')} />
            {err('website')}
          </div>

          <h2 className={styles.panelTitle}>Where it is</h2>
          <div className={styles.addressRow}>
            <div className="field">
              <label htmlFor="unit" className="field-label">
                Unit (optional)
              </label>
              <input id="unit" name="unit" className="input" maxLength={30} autoComplete="address-line2" placeholder="Like 2B"
                defaultValue={typed.unit ?? ''} aria-describedby={described('unit')} />
              {err('unit')}
            </div>
            <div className="field">
              <label htmlFor="number" className="field-label">
                Street number
              </label>
              <input id="number" name="number" className="input" maxLength={13} placeholder="Like 22" defaultValue={typed.number ?? ''}
                aria-describedby={described('number')} />
              {err('number')}
            </div>
            <div className="field">
              <label htmlFor="street" className="field-label">
                Street
              </label>
              <input id="street" name="street" className="input" maxLength={120} autoComplete="address-line1" placeholder="Like Lakeshore Road"
                defaultValue={typed.street ?? ''} aria-describedby={described('street')} />
              {err('street')}
            </div>
          </div>
          <label className={styles.keep}>
            <input type="checkbox" name="hideNumber" value="yes" defaultChecked={typed.hideNumber === 'yes'} />
            <span>
              <strong>Keep my street number private.</strong> Only the street and town will show, with the pin near the street, marked “
              {APPROXIMATE}”. We don’t keep the number or unit at all; share them in a message when you’re ready.
            </span>
          </label>
          <div className={styles.addressRow}>
            <div className="field">
              <label htmlFor="town" className="field-label">
                Town
              </label>
              <input id="town" name="town" className="input" maxLength={100} required autoComplete="address-level2" placeholder="Like Orillia"
                defaultValue={typed.town ?? ''} aria-describedby={described('town')} />
              {err('town')}
            </div>
            <div className="field">
              <label htmlFor="postalCode" className="field-label">
                Postal code (optional)
              </label>
              <input id="postalCode" name="postalCode" className="input" maxLength={7} autoComplete="postal-code" placeholder="Like L3V 1A1"
                defaultValue={typed.postalCode ?? ''} aria-describedby={described('postalCode')} />
              {err('postalCode')}
            </div>
          </div>

          <h2 className={styles.panelTitle}>Confirming it’s yours</h2>
          <div className="field">
            <label htmlFor="contact" className="field-label">
              The business’s phone number or email
            </label>
            <p className="field-hint" id="contact-hint">
              Our team uses it to confirm the business is yours, as we do for every claim.
            </p>
            <input id="contact" name="contact" className="input" maxLength={200} required defaultValue={typed.contact ?? ''}
              aria-describedby={described('contact', 'contact-hint')} />
            {err('contact')}
          </div>
          <RelationshipChoice legend="How are you connected to it?" error={errors.relationship} defaultValue={typed.relationship} />
          <div className="field">
            <label htmlFor="note" className="field-label">
              Anything else for our team (optional)
            </label>
            <p className="field-hint" id="note-hint">
              For example, the best time to call. Seen only by our team.
            </p>
            <textarea id="note" name="note" className="input" maxLength={1000} defaultValue={typed.note ?? ''}
              aria-describedby={described('note', 'note-hint')} />
            {err('note')}
          </div>
          <label className={styles.keep}>
            <input type="checkbox" name="authorised" value="yes" required defaultChecked={typed.authorised === 'yes'}
              aria-describedby={errors.authorised ? 'authorised-error' : undefined} />
            <span>I’m allowed to manage this business’s listing.</span>
          </label>
          {err('authorised')}
          <p>
            <button type="submit" className="button button-primary" disabled={busy}>
              {busy ? 'Sending…' : 'Send to our team'}
            </button>
          </p>
        </Form>
      </main>
    </>
  );
}
