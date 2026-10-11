import { describeEvidence, emailMatchesWebsite } from '@/lib/domain-match';
import type { Member } from './auth/member.server';
import { AUTO_DECLINE_REASON, type Relationship, RELATIONSHIPS } from './member-input';
import { emailPerson, emailTeam, renderEmail } from './email-templates.server';
import type { ServerEnv } from './env';

/**
 * Emails about claims (D-26: notices by email). Each email to a person is recorded in
 * `notification` with an honest status; they run after the page has answered.
 */

export async function emailClaimReceived(
  env: ServerEnv,
  siteUrl: string,
  member: Member,
  claim: { id: string; business: string; relationship: Relationship; websiteUrl: string | null },
): Promise<void> {
  await emailPerson(
    env,
    member,
    'claim_received',
    { type: 'vendor_claim', id: claim.id },
    renderEmail('received', { name: member.name, business: claim.business, accountUrl: `${siteUrl}/account` }),
  );
  await emailTeam(
    env,
    renderEmail('team', {
      name: member.name,
      email: member.email,
      business: claim.business,
      relationship: RELATIONSHIPS[claim.relationship],
      evidence: describeEvidence(emailMatchesWebsite(member.email, claim.websiteUrl)),
      claimsUrl: `${siteUrl}/admin/claims#c-${claim.id}`,
    }),
  );
}

type Person = { userId: string; name: string; email: string };

export async function emailClaimDecision(
  env: ServerEnv,
  siteUrl: string,
  claimId: string,
  decided: { business: string; slug: string; claimant: Person; declined: (Person & { claimId: string })[] },
  outcome: { approved: true } | { approved: false; reason: string },
): Promise<void> {
  const { business, claimant } = decided;
  await emailPerson(
    env,
    claimant,
    'claim_decision',
    { type: 'vendor_claim', id: claimId },
    outcome.approved
      ? renderEmail('approved', { name: claimant.name, business, note: '', editUrl: `${siteUrl}/vendors/${decided.slug}/edit`, accountUrl: `${siteUrl}/account` })
      : renderEmail('declined', { name: claimant.name, business, reason: outcome.reason }),
  );
  // Everyone else who claimed the same business hears that another claim was approved.
  for (const other of decided.declined) {
    await emailPerson(
      env,
      other,
      'claim_decision',
      { type: 'vendor_claim', id: other.claimId },
      renderEmail('declined', { name: other.name, business, reason: AUTO_DECLINE_REASON }),
    );
  }
}
