import { describe, expect, it } from 'vitest';
import { discardBody } from '@/server/discard-body';

describe('letting a refused request arrive before answering', () => {
  it('reads the whole of a small body', async () => {
    const req = new Request('https://l.test/x', { method: 'POST', body: 'x'.repeat(5000) });
    await discardBody(req);
    expect(req.bodyUsed).toBe(true);
  });

  it('stops listening after 2 MB', async () => {
    let sent = 0;
    const big = new ReadableStream<Uint8Array>({
      pull(c) {
        sent += 64 * 1024;
        c.enqueue(new Uint8Array(64 * 1024));
        if (sent > 10 * 1024 * 1024) c.close();
      },
    });
    const req = new Request('https://l.test/x', { method: 'POST', body: big, duplex: 'half' } as RequestInit);
    await discardBody(req);
    expect(sent).toBeLessThan(3 * 1024 * 1024);
  });

  it('does nothing without a body', async () => {
    await expect(discardBody(new Request('https://l.test/x'))).resolves.toBeUndefined();
  });
});
