import { describe, expect, it } from 'vitest';
import { quieter } from '@/components/baseMap';

describe('the Bright map, quieter (the owner, 26 October 2026)', () => {
  it('keeps roads, water, parks and names, and leaves out buildings, icons, house numbers and paths', () => {
    const style = {
      version: 8,
      layers: [
        { id: 'background' },
        { id: 'water', 'source-layer': 'water' },
        { id: 'park', 'source-layer': 'park' },
        { id: 'highway-primary', 'source-layer': 'transportation' },
        { id: 'highway-name-major', 'source-layer': 'transportation_name' },
        { id: 'place-town', 'source-layer': 'place' },
        { id: 'building', 'source-layer': 'building' },
        { id: 'building-3d', 'source-layer': 'building' },
        { id: 'poi-level-1', 'source-layer': 'poi' },
        { id: 'housenumber', 'source-layer': 'housenumber' },
        { id: 'airport-label', 'source-layer': 'aerodrome_label' },
        { id: 'highway-path', 'source-layer': 'transportation' },
        { id: 'road_oneway', 'source-layer': 'transportation' },
      ],
    };
    const kept = quieter(style);
    expect(kept.layers.map((l) => l.id)).toEqual(['background', 'water', 'park', 'highway-primary', 'highway-name-major', 'place-town']);
    expect(kept.version).toBe(8);
  });
});
