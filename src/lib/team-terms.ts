/**
 * Words for a business's team (screen V4, E §3), shared by the pages and the invitation
 * email. Browser-safe; scanned by `npm run check:words`.
 *   manager: everything the owner does, except the team and ownership;
 *   staff: reads and replies to the business's messages (Stage 2B).
 */
export type TeamRole = 'manager' | 'staff';

export const TEAM_ROLES: Record<TeamRole, { name: string; what: string }> = {
  manager: {
    name: 'a manager',
    what: 'A manager can edit the business’s listing, reply to and block its messages, see who marked it as booked, and see its Analytics if they’re on. Only the owner can change the team.',
  },
  staff: {
    name: 'staff',
    what: 'Staff can read and reply to customers’ messages to the business on Localites.',
  },
};
