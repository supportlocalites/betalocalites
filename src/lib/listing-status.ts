/** Listing statuses and the changes an admin may make (B §4; enforced in listings.server.ts). */
export type ListingStatus = 'draft' | 'pending_review' | 'published' | 'unpublished' | 'archived';

export const STATUS_LABEL: Record<ListingStatus, string> = {
  draft: 'Draft',
  pending_review: 'Waiting for review',
  published: 'Live',
  unpublished: 'Hidden',
  archived: 'Archived',
};

/**
 * The listing lifecycle (B §4): draft → pending_review → published ⇄ unpublished → archived.
 * Listings the team creates are reviewed by the team, so an admin may publish a draft.
 * Archived is final.
 */
export const ADMIN_TRANSITIONS: Record<ListingStatus, ListingStatus[]> = {
  draft: ['published', 'archived'],
  pending_review: ['published', 'draft'],
  published: ['unpublished'],
  unpublished: ['published', 'archived'],
  archived: [],
};

/** How a service's price is shown (mirrors vendor_service.pricing_model). */
export const PRICING_MODELS = ['fixed', 'starting_at', 'hourly', 'on_request', 'not_listed'] as const;
