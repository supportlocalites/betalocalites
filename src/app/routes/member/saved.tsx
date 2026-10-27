import { redirect } from 'react-router';

/**
 * The old favourites page (C6): favourites are Browse local's own view now, the same from every
 * page (the owner, 27 October 2026: "need it to look the same as when you go from explore to
 * favourites every time"). Old links and bookmarks go there.
 */
export function loader() {
  return redirect('/explore?fav=1');
}
