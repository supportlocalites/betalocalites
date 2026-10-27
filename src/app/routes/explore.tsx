import { cloudflareContext } from '@/app/context';
import { Directory } from '@/components/Directory';
import { shareMeta } from '@/lib/meta';
import { loadDirectory } from '@/server/directory-page.server';
import type { Route } from './+types/explore';

export const meta: Route.MetaFunction = ({ matches }) => shareMeta(matches, '/explore', 'Browse local');

/** No footer: the Base44 design has none (D-59, K19). */
export const handle = { noFooter: true };

export async function loader({ request, context }: Route.LoaderArgs) {
  return loadDirectory(request, context.get(cloudflareContext).env);
}

// The visitor cookie a new browser gets with the page (ADR-030).
export const headers: Route.HeadersFunction = ({ loaderHeaders }) => loaderHeaders;

export default function Explore({ loaderData }: Route.ComponentProps) {
  const { cards, kinds, shortlist, signedIn, tracks, home } = loaderData;
  return <Directory cards={cards} kinds={kinds} shortlist={shortlist} signedIn={signedIn} tracks={tracks} initial={null} home={home} />;
}
