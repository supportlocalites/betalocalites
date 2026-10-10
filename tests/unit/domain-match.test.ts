import { describe, expect, it } from 'vitest';
import { describeEvidence, emailMatchesWebsite } from '@/lib/domain-match';

describe('claim evidence: email vs the business’s own website (D-33)', () => {
  it.each([
    ['jane@sweettreats.ca', 'https://sweettreats.ca/', 'match'],
    ['jane@sweettreats.ca', 'https://www.sweettreats.ca/cakes', 'match'],
    ['jane@mail.sweettreats.ca', 'https://sweettreats.ca', 'match'],
    ['Jane@SweetTreats.CA', 'https://SWEETTREATS.ca', 'match'],
    ['parks@orillia.ca', 'https://www.orillia.ca/en/living-here/multi-purpose-meeting-rooms.aspx', 'match'],
  ])('%s with %s → %s', (email, site, result) => {
    expect(emailMatchesWebsite(email, site).result).toBe(result);
  });

  it.each([
    ['jane@gmail.com', 'https://sweettreats.ca', 'personal_email'],
    ['jane@rogers.com', 'https://sweettreats.ca', 'personal_email'],
    ['jane@facebook.com', 'https://www.facebook.com/sweettreats', 'platform_website'],
    ['jane@sweettreats.ca', 'https://www.instagram.com/sweettreats/', 'platform_website'],
    ['jane@sweettreats.ca', 'https://sweettreats.wixsite.com/home', 'platform_website'],
    ['jane@sweettreats.ca', null, 'no_website'],
    ['jane@othercakes.ca', 'https://sweettreats.ca', 'different'],
    // Look-alikes must not match.
    ['jane@sweettreats.ca.evil.example', 'https://sweettreats.ca', 'different'],
    ['jane@notsweettreats.ca', 'https://sweettreats.ca', 'different'],
    // An address at the domain a website sits under proves nothing (anyone can have one at an ISP).
    ['bob@someisp.ca', 'https://bakery.someisp.ca', 'different'],
    ['jane@sweettreats.ca', 'https://shop.sweettreats.ca', 'different'],
    ['jane@ca', 'https://sweettreats.ca', 'personal_email'],
  ])('%s with %s → %s (the team must contact the business)', (email, site, result) => {
    const evidence = emailMatchesWebsite(email, site);
    expect(evidence.result).toBe(result);
    expect(describeEvidence(evidence)).toContain('contact the business');
  });
});
