import { type ReactNode, useEffect, useRef } from 'react';
import { CENTRE } from '@/lib/centre';
import type { DirectoryCard } from '@/server/browse.server';
import styles from './Directory.module.css';

type L = typeof import('leaflet');

type MapState = { L: L; map: import('leaflet').Map; layer: import('leaflet').LayerGroup; flying: boolean; flownTo: string | null };

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
    // The map moving itself isn't the visitor moving it ("Search this area" stays as it was).
    s.flying = true;
    s.map.flyTo([open.lat!, open.lng!], Math.max(s.map.getZoom(), 13), { duration: 0.6 });
    setTimeout(() => (s.flying = false), 900);
  }
}

/**
 * The map strip of the Base44 design (D-59): every business that shared an address as a small
 * white dot with a gold ring; the open one larger, in gold, and the map glides to it. The map
 * is OpenStreetMap's, free (D-59, K5), tinted to Base44's grey. Tapping a dot opens the profile.
 */
export function DirectoryMap({
  cards,
  selected,
  onSelect,
  layout,
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
      const s: MapState = { L, map, layer: L.layerGroup().addTo(map), flying: false, flownTo: null };
      state.current = s;
      map.on('dragstart', () => moved.current());
      map.on('zoomstart', () => {
        if (!s.flying) moved.current();
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

  // The map grows or shrinks (the view changes, the profile panel opens beside it): once that has
  // happened it measures itself again, so its middle is the middle of what can be seen, and the
  // open business is put back there.
  useEffect(() => {
    const id = setTimeout(() => {
      const s = state.current;
      if (!s) return;
      s.map.invalidateSize();
      const open = latest.current.pins.find((c) => c.slug === latest.current.selected);
      if (open && s.map.getSize().x > 0) {
        s.flying = true;
        s.map.panTo([open.lat!, open.lng!], { animate: true });
        setTimeout(() => (s.flying = false), 900);
      }
    }, 320);
    return () => clearTimeout(id);
  }, [layout]);

  return (
    <div className={className}>
      {/* The cards hold the same businesses for keyboards and screen readers; the map is for pointing at. */}
      <div ref={box} className={styles.mapCanvas} role="region" aria-label="Map of the businesses that shared an address" />
      {children}
    </div>
  );
}
