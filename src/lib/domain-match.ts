/**
 * D-33: a claim is easier to trust when the claimant signed in with an email address at
 * the business's own website (jane@sweettreats.ca for sweettreats.ca). The team still
 * decides; this only tells them what the evidence shows.
 */

// Personal email services: anyone can have an address there, so it proves nothing.
const PERSONAL_EMAIL = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'hotmail.ca', 'live.com', 'live.ca', 'msn.com',
  'yahoo.com', 'yahoo.ca', 'ymail.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com',
  'pm.me', 'gmx.com', 'gmx.ca', 'mail.com', 'zoho.com', 'fastmail.com', 'hushmail.com', 'tutanota.com',
  'rogers.com', 'bell.net', 'sympatico.ca', 'shaw.ca', 'telus.net', 'cogeco.ca', 'eastlink.ca', 'xplornet.com',
]);

// Websites that host many businesses' pages: a business on one doesn't own the domain.
const PLATFORM_SITES = [
  'facebook.com', 'fb.com', 'instagram.com', 'tiktok.com', 'youtube.com', 'x.com', 'twitter.com', 'linkedin.com',
  'pinterest.com', 'linktr.ee', 'google.com', 'business.site', 'wixsite.com', 'wix.com', 'squarespace.com',
  'weebly.com', 'godaddysites.com', 'wordpress.com', 'blogspot.com', 'etsy.com', 'square.site', 'myshopify.com',
  'canva.site', 'carrd.co', 'weddingwire.ca', 'weddingwire.com', 'theknot.com', 'yelp.ca', 'yelp.com',
  'opentable.com', 'opentable.ca', 'tripadvisor.ca', 'tripadvisor.com', 'shoporillia.com', 'orilliamatters.com',
];

export type DomainEvidence =
  | { result: 'match'; emailDomain: string; websiteDomain: string }
  | { result: 'personal_email'; emailDomain: string }
  | { result: 'platform_website'; websiteDomain: string }
  | { result: 'no_website' }
  | { result: 'different'; emailDomain: string; websiteDomain: string };

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  } catch {
    return null;
  }
};

const within = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

export function emailMatchesWebsite(email: string, websiteUrl: string | null): DomainEvidence {
  const emailDomain = email.split('@').pop()?.toLowerCase().trim().replace(/\.$/, '') ?? '';
  const websiteDomain = websiteUrl ? hostOf(websiteUrl) : null;
  if (!websiteDomain) return { result: 'no_website' };
  if (PLATFORM_SITES.some((p) => within(websiteDomain, p))) return { result: 'platform_website', websiteDomain };
  if (!emailDomain.includes('.') || PERSONAL_EMAIL.has(emailDomain)) return { result: 'personal_email', emailDomain };
  // The email must be at the website's own domain (or one of its subdomains). Not the
  // other way round: a website at bakery.someisp.ca doesn't make everyone@someisp.ca its owner.
  if (within(emailDomain, websiteDomain)) return { result: 'match', emailDomain, websiteDomain };
  return { result: 'different', emailDomain, websiteDomain };
}

/** Plain words for the team's Claims page. */
export function describeEvidence(e: DomainEvidence): string {
  switch (e.result) {
    case 'match':
      return `Email matches the business’s own website (${e.websiteDomain}).`;
    case 'personal_email':
      return `Personal email address (${e.emailDomain}): contact the business to confirm.`;
    case 'platform_website':
      return `The business’s web page is on ${e.websiteDomain}, which proves nothing: contact the business to confirm.`;
    case 'no_website':
      return 'The listing has no website to compare: contact the business to confirm.';
    case 'different':
      return `Email (${e.emailDomain}) doesn’t match the business’s website (${e.websiteDomain}): contact the business to confirm.`;
  }
}
