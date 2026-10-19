/** Browse local's sort orders (D-57), shared by the page and the server. */
export const SORTS = ['match', 'rated', 'saved', 'new'] as const;
export type Sort = (typeof SORTS)[number];
export const SORT_WORDS: Record<Sort, string> = {
  match: 'Best match',
  rated: 'Top rated',
  saved: 'Your favourites first',
  new: 'Newest on Localites',
};
