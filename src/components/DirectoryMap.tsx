import { type ReactNode, useEffect, useRef } from 'react';
import { CENTRE } from '@/lib/centre';
import type { DirectoryCard } from '@/server/browse.server';
import styles from './Directory.module.css';

type L = typeof import('leaflet');

type MapState = { L: L; map: import('leaflet').Map; layer: import('leaflet').LayerGroup };
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
  if (open) s.map.flyTo([open.lat!, open.lng!], Math.max(s.map.getZoom(), 13), { duration: 0.6 });
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
  expanded,
  className,
  children,
}: {
  cards: DirectoryCard[];
  selected: string | null;
  onSelect: (slug: string) => void;
  expanded: boolean;
  className: string;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const state = useRef<MapState | null>(null);
  const latest = useRef<Latest>({ pins: [], selected: null, onSelect });
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
      state.current = { L, map, layer: L.layerGroup().addTo(map) };
      drawPins(state.current, latest.current);
    })().catch((err) => console.error('map not shown:', err instanceof Error ? err.message : err));
    return () => {
      gone = true;
      state.current?.map.remove();
      state.current = null;
    };
  }, []);

  useEffect(() => {
    latest.current = { pins, selected, onSelect };
    drawPins(state.current, latest.current);
    // Redrawn only when the dots or the open one change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // The strip grows or shrinks: the map measures itself again once the change has happened.
  useEffect(() => {
    const id = setTimeout(() => state.current?.map.invalidateSize(), 260);
    return () => clearTimeout(id);
  }, [expanded]);

  return (
    <div className={className}>
      {/* The cards hold the same businesses for keyboards and screen readers; the map is for pointing at. */}
      <div ref={box} className={styles.mapCanvas} role="region" aria-label="Map of the businesses that shared an address" />
      {children}
    </div>
  );
}
