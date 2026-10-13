import { describe, expect, it } from 'vitest';
import { defaultFrame, keepInRange, placement, readFrame, showsBackdrop } from '@/lib/photo-frame';

describe('the profile photo in its square', () => {
  it('a nearly square photo fills the square, centred', () => {
    const f = defaultFrame(1200, 1000); // 1.2 wide
    expect(f.h).toBe(100);
    expect(f.w).toBeCloseTo(83.333, 2);
    expect(f.x).toBeCloseTo(8.333, 2);
    expect(showsBackdrop(f)).toBe(false);
  });

  it('a wide photo shows whole, with the blurred copy above and below', () => {
    const f = defaultFrame(1600, 900);
    expect(f).toMatchObject({ x: 0, w: 100 });
    expect(f.h).toBeCloseTo(177.78, 1);
    expect(f.y).toBeCloseTo(-38.89, 1);
    expect(showsBackdrop(f)).toBe(true);
  });

  it('a tall photo shows whole, with the blurred copy at the sides', () => {
    const f = defaultFrame(900, 1600);
    expect(f).toMatchObject({ y: 0, h: 100 });
    expect(f.w).toBeCloseTo(177.78, 1);
    expect(showsBackdrop(f)).toBe(true);
  });

  it('places the framed part exactly over the square', () => {
    expect(placement({ x: 25, y: 0, w: 50, h: 100 })).toEqual({ left: '-50%', top: '0%', width: '200%', height: '100%' });
    // Zoomed out: the photo is drawn smaller than the square, inside it.
    expect(placement({ x: 0, y: -50, w: 100, h: 200 })).toEqual({ left: '0%', top: '25%', width: '100%', height: '50%' });
  });

  it('only takes a sensible framing from the page', () => {
    expect(readFrame({ x: '10', y: '5', w: '80', h: '90' })).toEqual({ x: 10, y: 5, w: 80, h: 90 });
    expect(readFrame({ x: '10', y: '5', w: '0', h: '90' })).toBeNull();
    expect(readFrame({ x: 'NaN', y: '5', w: '80', h: '90' })).toBeNull();
    expect(readFrame({ x: '10', y: '5', w: '80' })).toBeNull();
    expect(readFrame({ x: '-900', y: '5', w: '80', h: '90' })).toBeNull();
  });

  it('keeps a photo dragged almost out of the square in range, still square on the photo', () => {
    // 600% tall on a photo 7.5 times wider than tall: shrunk about its middle to 500%.
    const ok = keepInRange({ x: 140, y: -900, w: 80, h: 600 });
    expect(ok).toEqual({ x: 100, y: -400, w: 66.667, h: 500 });
    expect(readFrame({ x: String(ok.x), y: String(ok.y), w: String(ok.w), h: String(ok.h) })).toEqual(ok);
  });

  it('a banner more than 5 times wider than tall shows its middle at the most zoomed-out size', () => {
    const f = defaultFrame(1200, 200); // 6 wide
    expect(f.h).toBe(500);
    expect(f.w).toBeCloseTo(83.333, 2);
    expect(f.x).toBeCloseTo(8.333, 2);
    expect(f.y).toBe(-200);
  });

  it('a tiny size that would round to nothing is refused, not passed on', () => {
    expect(readFrame({ x: '0', y: '0', w: '0.0004', h: '50' })).toBeNull();
  });
});
