/** The robots that fetch a link to draw its preview in a chat or post. */
const PREVIEW_ROBOTS = /WhatsApp\/|facebookexternalhit|Facebot|Twitterbot|Slackbot|TelegramBot|Discordbot|LinkedInBot|SkypeUriPreview/i;

/**
 * What a link-preview robot (WhatsApp, Facebook, Messages, Slack) gets for an invitation link,
 * instead of the swap into a cookie: a plain "You're invited" card with the Localites picture.
 * Never the event's name, date, place or host, and no cookie, so a preview can't count as the
 * guest opening their invitation. People's browsers carry on as before (null). In case a person
 * is ever taken for a robot, the card links on with ?open=1, which always goes through.
 */
export function invitePreview(request: Request): Response | null {
  const url = new URL(request.url);
  if (url.searchParams.has('open') || !PREVIEW_ROBOTS.test(request.headers.get('User-Agent') ?? '')) return null;
  const origin = url.origin;
  const html = `<!doctype html><html lang="en-CA"><head><meta charset="utf-8">
<title>You’re invited · Localites</title>
<meta name="robots" content="noindex">
<meta name="description" content="Open the link to see your invitation and reply.">
<meta property="og:site_name" content="Localites">
<meta property="og:type" content="website">
<meta property="og:title" content="You’re invited">
<meta property="og:description" content="Open the link to see your invitation and reply.">
<meta property="og:image" content="${origin}/share.png">
<meta name="twitter:card" content="summary_large_image">
</head><body><p>You’re invited. <a href="${url.pathname}?open=1">Open your invitation</a> to see it and reply.</p></body></html>`;
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  });
}
