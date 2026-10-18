import { sql } from 'drizzle-orm';
import { actingAs } from '../acting.server';
import type { Admin } from '../auth/admin.server';
import type { ServerEnv } from '../env';

/** One kind of work waiting for the team: how many, and since when (the oldest). */
export type Waiting = { kind: WaitingKind; count: number; oldest: string | null };

export type WaitingKind =
  | 'held_changes'
  | 'reviews'
  | 'reported_reviews'
  | 'held_replies'
  | 'reports'
  | 'claims'
  | 'deletions'
  | 'flags'
  | 'check_ins'
  | 'suggestions'
  | 'inquiries';

/**
 * Admin → Waiting for you (product owner, 18 October 2026): everything waiting for the team in
 * one place, counted the same way as the team menu. Counts and dates only, never who. Acting
 * as the team (ADR-031); callers must have passed adminGate.
 */
export async function waitingWork(env: ServerEnv, admin: Admin): Promise<Waiting[]> {
  return actingAs(env, { side: 'team', userId: admin.userId }, async (tx) => {
    const rows = await tx.execute<{ kind: WaitingKind; count: number; oldest: string | null }>(sql`
      select 'held_changes' as kind, count(*)::int as count, min(created_at)::text as oldest
        from owner_edit_hold where status = 'waiting'
      union all
      select 'reviews', count(*)::int, min(created_at)::text from review where status = 'pending'
      union all
      select 'reported_reviews', count(distinct review_id)::int, min(created_at)::text from review_report where status = 'open'
      union all
      select 'held_replies', count(*)::int, min(reply_held_at)::text
        from review where reply_held_at is not null and reply_removed_at is null and status = 'published'
      union all
      select 'reports', count(*)::int, min(created_at)::text from moderation_report where status = 'open'
      union all
      select 'claims', count(*)::int, min(created_at)::text from vendor_claim where status = 'submitted'
      union all
      select 'deletions', count(*)::int, min(requested_at)::text from account_deletion where auth_removed_at is null
      union all
      select 'flags', count(*)::int, min(vendor_flagged_at)::text
        from event_vendor where vendor_flagged_at is not null and flag_resolved_at is null
      union all
      select 'check_ins', taken_down_booking_count(), null
      union all
      select 'suggestions', count(*)::int, min(created_at)::text from vendor_suggestion where status = 'new'
      union all
      select 'inquiries', count(*)::int, min(vi.created_at)::text
        from vendor_interest vi join vendor v on v.id = vi.vendor_id
        where v.claim_status <> 'claimed' and v.listing_status = 'published'`);
    return rows.map((r) => ({ kind: r.kind, count: Number(r.count), oldest: r.oldest }));
  });
}
