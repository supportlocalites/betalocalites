import { type ReactNode, useEffect, useRef } from 'react';
import { CENTRE } from '@/lib/centre';
import type { DirectoryCard } from '@/server/browse.server';
import styles from './Directory.module.css';

type L = typeof import('leaflet');

type MapState = {
  L: L;
  map: import('leaflet').Map;
  layer: import('leaflet').LayerGroup;
  flying: boolean;
  flownTo: string | null;
  /** The full-size view from before the profile panel opened, and whether the visitor has moved the map since. */
  before: { bounds: import('leaflet').LatLngBounds; center: import('leaflet').LatLng; zoom: number; moved: boolean } | null;
};

/** The part of the map on screen: "Search this area" keeps the businesses inside it. */
export type Bounds = { south: number; west: number; north: number; east: number };
export type MapApi = { bounds: () => Bounds | null };
type Latest = { pins: DirectoryCard[]; selected: string | null; onSelect: (slug: string) => void };

/** The dots, drawn again whenever the businesses shown or the open one change. */
function drawPins(s: MapState | null, { pins, selected, onSelect }: Latest) {
  if (!s) return;
  s.layer.clearLayers();
  for (const c of pins) {
    const open = c.slug === selected;
    const icon = s.L.divIcon({ className: `${styles.dot} ${open ? styles.dotOpen : ''}`, iconSize: open ? [18, 18] : [12, 12] });
    const marker = s.L.marker([c.lat!, c.lng!], { icon, keyboard: false, zIndexOffset: open ? 1000 : 0, title: c.name });
    marker.on('click', () => onSelect(c.slug));
    marker.addTo(s.layer);
    marker.getElement()?.setAttribute('aria-hidden', 'true');
  }
  const open = pins.find((c) => c.slug === selected);
  if (!open) s.flownTo = null;
  // Only when a different business opens (not when the filters change what's shown), and not
  // while the map is hidden (a phone showing a profile).
  if (open && open.slug !== s.flownTo && s.map.getSize().x > 0) {
    s.flownTo = open.slug;
    showIfHidden(s, open);
  }
}

/**
 * The map stays where the visitor left it while they switch between businesses, and only the
 * open one's dot changes, so they can see where the others are (the owner, 25 October 2026). It
 * moves only to bring a dot that's out of sight (or right at the edge) into view.
 */
function showIfHidden(s: MapState, open: DirectoryCard) {
  const at = s.L.latLng(open.lat!, open.lng!);
  if (s.map.getBounds().pad(-0.1).contains(at)) return;
  // The map moving itself isn't the visitor moving it ("Search this area" stays as it was).
  s.flying = true;
  s.map.panTo(at, { animate: true, duration: 0.5 });
  setTimeout(() => (s.flying = false), 900);
}

/**
 * The map strip of the Base44 design (D-59): every business that shared an address as a small
 * white dot with a gold ring; the open one larger, in gold (the map moves only if it's out of sight). The map
 * is OpenStreetMap's, free (D-59, K5), tinted to Base44's grey. Tapping a dot opens the profile.
 */
export function DirectoryMap({
  cards,
  selected,
  onSelect,
  layout,
  panelOpen,
  onMoved,
  onReady,
  className,
  children,
}: {
  cards: DirectoryCard[];
  selected: string | null;
  onSelect: (slug: string) => void;
  /** Changes whenever the map's size does (the view, the profile panel opening or widening). */
  layout: string;
  /** The profile panel is open beside the map (it narrows the map). */
  panelOpen: boolean;
  /** The visitor dragged or zoomed the map. */
  onMoved: () => void;
  /** The map's own controls once it's drawn (null when it goes). */
  onReady: (api: MapApi | null) => void;
  className: string;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const state = useRef<MapState | null>(null);
  const latest = useRef<Latest>({ pins: [], selected: null, onSelect });
  const moved = useRef(onMoved);
  const pins = cards.filter((c) => c.lat !== null && c.lng !== null);
  const key = JSON.stringify(pins.map((c) => [c.slug, c.lat, c.lng])) + selected;

  useEffect(() => {
    let gone = false;
    (async () => {
      const [L] = await Promise.all([import('leaflet').then((m) => m.default ?? m), import('leaflet/dist/leaflet.css')]);
      if (gone || !box.current) return;
      const map = L.map(box.current, { scrollWheelZoom: true, attributionControl: true }).setView([CENTRE.lat, CENTRE.lng], 12);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        className: styles.tiles,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);
      const s: MapState = { L, map, layer: L.layerGroup().addTo(map), flying: false, flownTo: null, before: null };
      state.current = s;
      const visitorMoved = () => {
        if (s.before) s.before.moved = true;
        moved.current();
      };
      map.on('dragstart', visitorMoved);
      map.on('zoomstart', () => {
        if (!s.flying) visitorMoved();
      });
      onReady({
        bounds: () => {
          const b = map.getBounds();
          return { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() };
        },
      });
      drawPins(s, latest.current);
    })().catch((err) => console.error('map not shown:', err instanceof Error ? err.message : err));
    return () => {
      gone = true;
      state.current?.map.remove();
      state.current = null;
      onReady(null);
    };
  }, [onReady]);

  useEffect(() => {
    moved.current = onMoved;
  }, [onMoved]);

  useEffect(() => {
    latest.current = { pins, selected, onSelect };
    drawPins(state.current, latest.current);
    // Redrawn only when the dots or the open one change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // The profile panel opening beside the map narrows it (the owner, 26 October 2026: "I want the
  // map to shrink down to the viewable area ... when I exit the vendor I want the map to go back
  // to the full screen"): what was on screen is fitted into the narrower map, so no business is
  // left out of sight, and closing the panel puts back the full view (unless the visitor has
  // moved the map meanwhile). Before the panel's slide, the full view is noted.
  const panelWas = useRef(panelOpen);
  useEffect(() => {
    const s = state.current;
    const opening = panelOpen && !panelWas.current;
    const closing = !panelOpen && panelWas.current;
    panelWas.current = panelOpen;
    if (s && opening && s.map.getSize().x > 0) {
      s.before = { bounds: s.map.getBounds(), center: s.map.getCenter(), zoom: s.map.getZoom(), moved: false };
    }
    const id = setTimeout(() => {
      const s = state.current;
      if (!s) return;
      // Keeps its top left where it was, so nothing jumps before it's fitted.
      s.map.invalidateSize({ pan: false });
      if (s.map.getSize().x === 0) return;
      const glide = (go: () => void) => {
        // The map moving itself isn't the visitor moving it ("Search this area" stays as it was).
        s.flying = true;
        go();
        setTimeout(() => (s.flying = false), 900);
      };
      const open = latest.current.pins.find((c) => c.slug === latest.current.selected);
      if (opening && s.before) {
        // Everything that was on screen, and the business just opened, fitted into what's left.
        const fit = s.L.latLngBounds(s.before.bounds.getSouthWest(), s.before.bounds.getNorthEast());
        if (open) fit.extend([open.lat!, open.lng!]);
        glide(() => s.map.fitBounds(fit, { animate: true }));
      } else if (closing && s.before) {
        const { center, zoom, moved: movedMeanwhile } = s.before;
        s.before = null;
        if (!movedMeanwhile) glide(() => s.map.setView(center, zoom, { animate: true }));
      }
      if (open && !opening) showIfHidden(s, open);
    }, 320);
    return () => clearTimeout(id);
  }, [layout, panelOpen]);

  return (
    <div className={className}>
      {/* The cards hold the same businesses for keyboards and screen readers; the map is for pointing at. */}
      <div ref={box} className={styles.mapCanvas} role="region" aria-label="Map of the businesses that shared an address" />
      {children}
    </div>
  );
}
