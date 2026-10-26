import type { Map as LeafletMap } from 'leaflet';

type L = typeof import('leaflet');

/**
 * The map itself under the pins (the owner, 26 October 2026: "more like google maps or Waze ... we
 * dont need to know the building shapes we jsut need the roads"; of OpenFreeMap's looks, "I like
 * Bright"). OpenFreeMap is free, with no account, key or limit. Its map comes as data the browser
 * draws, so the clutter is left out: buildings, shop and place icons, house numbers, footpaths and
 * one-way arrows. Roads, water, parks and names stay. Without WebGL, or if OpenFreeMap doesn't
 * answer, OpenStreetMap's own map is shown, as before.
 */
const STYLE = 'https://tiles.openfreemap.org/styles/bright';
const ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';

/** What's left out, by the kind of thing drawn (OpenMapTiles' names)… */
const DROP_KINDS = new Set(['building', 'poi', 'housenumber', 'aerodrome_label', 'mountain_peak']);
/** …and by the layer's own name, for paths and arrows drawn with the roads. */
const DROP_NAMES = /path|pedestrian|track|oneway|aerialway|ferry/;

type StyleLayer = { id: string; 'source-layer'?: string };
type Style = { layers: StyleLayer[] };

/** Keeps only what a quick look at a town needs. */
export function quieter<S extends Style>(style: S): S {
  return { ...style, layers: style.layers.filter((l) => !DROP_KINDS.has(l['source-layer'] ?? '') && !DROP_NAMES.test(l.id)) };
}

function canDraw(): boolean {
  try {
    return Boolean(document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl'));
  } catch {
    return false;
  }
}

/** Puts the map under the pins: OpenFreeMap's Bright, quieter; or OpenStreetMap's if that can't be drawn. */
export async function addBaseMap(L: L, map: LeafletMap, osmClass?: string): Promise<void> {
  try {
    if (!canDraw()) throw new Error('no WebGL');
    const res = await fetch(STYLE, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`style ${res.status}`);
    const style = quieter((await res.json()) as Style);
    const [maplibre, worker] = await Promise.all([
      import('maplibre-gl'),
      // Its helper that reads the map's data, as a file of its own (bundled, it can't find it).
      import('maplibre-gl/dist/maplibre-gl-worker.mjs?url'),
      import('maplibre-gl/dist/maplibre-gl.css'),
    ]);
    maplibre.setWorkerUrl(worker.default);
    // The plugin adds L.maplibreGL to Leaflet itself.
    await import('@maplibre/maplibre-gl-leaflet');
    const layer = (L as unknown as { maplibreGL?: (o: object) => import('leaflet').Layer }).maplibreGL;
    if (!layer) throw new Error('plugin not loaded');
    layer({ style, attributionControl: { customAttribution: ATTRIBUTION } }).addTo(map);
  } catch (err) {
    console.warn('OpenStreetMap map instead:', err instanceof Error ? err.message : err);
    try {
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        className: osmClass,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);
    } catch {
      // The map was closed meanwhile.
    }
  }
}
