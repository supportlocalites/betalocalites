import { data, redirect } from 'react-router';
import { cloudflareContext } from '@/app/context';
import { Directory } from '@/components/Directory';
import { pageMeta, shareMeta } from '@/lib/meta';
import { findRenamed, getVendor } from '@/server/catalog.server';
import { withDb } from '@/server/db.server';
import { publicReviews } from '@/server/reviews.server';
import { loadDirectory } from '@/server/directory-page.server';
import type { Route } from './+types/vendor';

/**
 * A business's own web address (D-59, K18): the Base44 design has no page of its own for a
 * business, so its address opens Browse local with its profile open. Shared links, Google and
 * link previews keep working (the preview shows the business, not Browse local).
 */
export const meta: Route.MetaFunction = ({ loaderData, matches }) =>
  loaderData
    ? shareMeta(
        matches,
        `/vendors/${loaderData.slug}`,
        loaderData.vendor.name,
        loaderData.vendor.tagline ?? `${loaderData.vendor.name} in ${loaderData.vendor.town}, on Localites.`,
        loaderData.vendor.photo ?? undefined,
      )
    : pageMeta('Not found');

export const handle = { noFooter: true };

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const found = await getVendor(env, params.slug);
  if (!found) {
    // A renamed listing: its old web address keeps working (shared links, Google).
    const current = await findRenamed(env, params.slug);
    if (current) throw redirect(`/vendors/${current}`, 301);
    throw data(null, { status: 404 });
  }
  // This visit's note is made with the page, where it's known where the visitor came from (Google,
  // a shared link), which the profile panel's own request can't know (ADR-030).
  const [page, reviews] = await Promise.all([loadDirectory(request, env, found.id), withDb(env, (db) => publicReviews(db, found.id))]);
  return data(
    {
      ...page.data,
      slug: params.slug,
      track: page.data.view,
      // Its reviews come with the page (search engines, link previews), not only when the panel asks.
      reviews,
      vendor: { name: found.name, tagline: found.tagline, town: found.town, photo: found.photos[0]?.url ?? found.profile?.url ?? null },
    },
    { headers: page.init?.headers },
  );
}

export const headers: Route.HeadersFunction = ({ loaderHeaders }) => loaderHeaders;

export default function VendorProfile({ loaderData }: Route.ComponentProps) {
  const { cards, kinds, shortlist, signedIn, tracks, slug, track, reviews, home } = loaderData;
  return (
    <Directory cards={cards} kinds={kinds} shortlist={shortlist} signedIn={signedIn} tracks={tracks} initial={slug} initialTrack={track} initialReviews={reviews} home={home} />
  );
}
