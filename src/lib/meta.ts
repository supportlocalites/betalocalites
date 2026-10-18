const DESCRIPTION = 'Find local businesses for your event in Orillia and area, and contact them directly.';

/** Page title and description, e.g. "Explore · Localites". */
export function pageMeta(title?: string, description: string = DESCRIPTION) {
  return [{ title: title ? `${title} · Localites` : 'Localites' }, { name: 'description', content: description }];
}

type Match = { id: string; data?: unknown; loaderData?: unknown } | undefined;

/**
 * pageMeta plus what a shared link shows (Facebook, WhatsApp, texts): title, description, the
 * page's full address and a picture (the business's own photo, or the Localites card,
 * public/share.png). Previews need full addresses, so the site's own comes from the root loader.
 * For public pages only: never for anything private.
 */
export function shareMeta(matches: readonly Match[], path: string, title?: string, description: string = DESCRIPTION, image?: string) {
  const root = matches.find((m) => m?.id === 'root');
  const origin = ((root?.loaderData ?? root?.data) as { origin?: string } | undefined)?.origin ?? '';
  const full = (url: string) => (url.startsWith('/') ? `${origin}${url}` : url);
  return [
    ...pageMeta(title, description),
    { property: 'og:site_name', content: 'Localites' },
    { property: 'og:type', content: 'website' },
    { property: 'og:title', content: title ?? 'Localites' },
    { property: 'og:description', content: description },
    { property: 'og:url', content: full(path) },
    { property: 'og:image', content: full(image ?? '/share.png') },
    { name: 'twitter:card', content: 'summary_large_image' },
  ];
}
