/** Bytes a refused request may still send before we stop listening (a photo upload is under 1.5 MB). */
const DISCARD_LIMIT = 2 * 1024 * 1024;

/**
 * Lets the rest of a refused request arrive and throws it away, then answers. Answering while
 * the browser is still sending (say, a photo) can break the connection on some servers, so
 * the person sees an error instead of the plain refusal. Anything past the limit is cut off.
 */
export async function discardBody(request: Request): Promise<void> {
  const body = request.body;
  if (!body || request.bodyUsed) return;
  const reader = body.getReader();
  let seen = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      seen += value.byteLength;
      if (seen > DISCARD_LIMIT) {
        await reader.cancel();
        return;
      }
    }
  } catch {
    // The browser stopped sending: nothing more to wait for.
  }
}
