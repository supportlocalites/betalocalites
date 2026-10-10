import { data, Form, Link, redirect, useNavigation } from 'react-router';
import { adminContext, cloudflareContext } from '@/app/context';
import { emptyListing, ListingFields, type ListingValues } from '@/components/admin/ListingFields';
import { pageMeta } from '@/lib/meta';
import { fieldErrors, formValues, listingInput } from '@/server/admin/listing-input';
import { createListing, formOptions, ListingConflict } from '@/server/admin/listings.server';
import type { Route } from './+types/listing-new';
import styles from './admin.module.css';

export const meta: Route.MetaFunction = () => [...pageMeta('Add a business · Team'), { name: 'robots', content: 'noindex' }];

export async function loader({ context }: Route.LoaderArgs) {
  return { options: await formOptions(context.get(cloudflareContext).env) };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const admin = context.get(adminContext);
  const raw = formValues(await request.formData(), ['categoryIds']);
  const parsed = listingInput.safeParse(raw);
  if (!parsed.success) return data({ errors: fieldErrors(parsed.error), values: raw }, { status: 400 });
  try {
    const id = await createListing(env, admin, parsed.data);
    return redirect(`/admin/listings/${id}?saved=created`);
  } catch (err) {
    if (err instanceof ListingConflict) return data({ errors: { [err.field]: err.message }, values: raw }, { status: 409 });
    throw err;
  }
}

export default function NewListing({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state === 'submitting';
  const values = (actionData?.values as unknown as ListingValues | undefined) ?? emptyListing;
  return (
    <>
      <Link to="/admin" className="text-link">
        ← All listings
      </Link>
      <h1 className="title-1 section-gap">Add a business</h1>
      <div className="title-rule" aria-hidden="true" />
      <p className="muted">
        Saved as a draft: nobody sees it until you publish it. Use only what the business publishes itself (its own
        website or social pages).
      </p>
      {actionData?.errors && (
        <p className="notice" role="alert">
          {actionData.errors.form ?? 'Some details need another look. They’re marked below.'}
        </p>
      )}
      <Form method="post" className={styles.form} noValidate>
        <ListingFields values={values} options={loaderData.options} errors={actionData?.errors} />
        <button type="submit" className="button button-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save draft'}
        </button>
      </Form>
    </>
  );
}
