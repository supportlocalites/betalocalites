/** Whether counting is on, said plainly (the activity key, PO-14). */
export function KeyNotice({ state }: { state: 'off' | 'short' | 'on' }) {
  if (state === 'on') return null;
  return (
    <p className="notice">
      {state === 'off'
        ? 'Counting is off: the activity key isn’t set in Cloudflare yet (PO-14).'
        : 'Counting is off: the activity key in Cloudflare is too short. It needs at least 32 characters; replace it with a longer one (PO-14).'}
    </p>
  );
}
