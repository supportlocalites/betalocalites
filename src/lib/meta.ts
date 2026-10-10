const DESCRIPTION = 'Find local businesses for your event in Orillia and area, and contact them directly.';

/** Page title and description, e.g. "Explore · Localites". */
export function pageMeta(title?: string, description: string = DESCRIPTION) {
  return [{ title: title ? `${title} · Localites` : 'Localites' }, { name: 'description', content: description }];
}
