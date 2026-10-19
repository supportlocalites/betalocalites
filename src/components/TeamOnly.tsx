import { isRouteErrorResponse, Link } from 'react-router';
import { SiteHeader } from './SiteHeader';

type Reason = 'owner_only' | 'owner_or_manager';

/** A business page refused to someone on its team who can't open it (refuseTeamMember). */
export function teamOnlyReason(error: unknown): Reason | null {
  if (!isRouteErrorResponse(error) || error.status !== 403) return null;
  const reason = (error.data as { reason?: string } | null)?.reason;
  return reason === 'owner_only' || reason === 'owner_or_manager' ? reason : null;
}

/** Says who can open the page instead of "not found" (scenario tests, C8). */
export function TeamOnly({ reason }: { reason: Reason }) {
  return (
    <>
      <SiteHeader />
      <main className="page narrow">
        <h1 className="title-1">{reason === 'owner_only' ? 'Only the owner can do this' : 'Only the owner or a manager can do this'}</h1>
        <div className="title-rule" aria-hidden="true" />
        <p className="muted">
          {reason === 'owner_only'
            ? 'Only the business’s owner on Localites can change its team. If you need a change, ask them.'
            : 'You’re on this business’s team as staff, so you can read and reply to its messages. Ask the owner if you need more.'}
        </p>
        <Link to="/business" className="button button-primary">
          My business
        </Link>
      </main>
    </>
  );
}
