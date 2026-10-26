import { useEffect, useRef } from 'react';
import { addBaseMap } from './baseMap';
import styles from './PinMap.module.css';

export type Pin = { lat: number; lng: number; name: string; href?: string; approximate: boolean };

/** The brand's pin (D-31), black with a round window, as the map's marker. */
const PIN_SVG =
  '<svg viewBox="0 0 24 34" aria-hidden="true" focusable="false"><path fill-rule="evenodd" d="M12 0C5.37 0 0 5.37 0 12c0 7.6 9.1 18.6 11.1 21a1.2 1.2 0 0 0 1.8 0C14.9 30.6 24 19.6 24 12 24 5.37 18.63 0 12 0zM12 6.6a5.4 5.4 0 1 1 0 10.8a5.4 5.4 0 0 1 0-10.8z"/></svg>';

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * A map with pins (D-57): OpenStreetMap's free map, drawn by Leaflet once the page's scripts
 * run (loaded only on pages with a map). An approximate pin has a soft circle round it, as the
 * address is only near (D-56). The words beside every map say the same in text, so nothing
 * depends on seeing it.
 */
export function PinMap({ pins, label, className = '' }: { pins: Pin[]; label: string; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const key = JSON.stringify(pins);
  useEffect(() => {
    let map: import('leaflet').Map | null = null;
    let gone = false;
    (async () => {
      const [L] = await Promise.all([import('leaflet').then((m) => m.default ?? m), import('leaflet/dist/leaflet.css')]);
      if (gone || !box.current || pins.length === 0) return;
      map = L.map(box.current, { scrollWheelZoom: false, attributionControl: true });
      // Drawn after the pins can be: the map's own look may take a moment to arrive.
      void addBaseMap(L, map, styles.tiles);
      const icon = L.divIcon({ className: styles.pin, html: PIN_SVG, iconSize: [24, 34], iconAnchor: [12, 34], popupAnchor: [0, -30] });
      for (const p of pins) {
        if (p.approximate) L.circle([p.lat, p.lng], { radius: 150, className: styles.near, interactive: false }).addTo(map);
        // The words beside the map hold the same links for keyboards and screen readers (and easy
        // taps); a pin is for pointing at, so it isn't a stop of its own.
        const marker = L.marker([p.lat, p.lng], { icon, keyboard: false }).addTo(map);
        marker.getElement()?.setAttribute('aria-hidden', 'true');
        const words = `${escape(p.name)}${p.approximate ? '<br><span>Approximate location</span>' : ''}`;
        marker.bindPopup(p.href ? `<a href="${escape(p.href)}">${words}</a>` : words);
      }
      if (pins.length === 1) map.setView([pins[0]!.lat, pins[0]!.lng], pins[0]!.approximate ? 15 : 16);
      else map.fitBounds(L.latLngBounds(pins.map((p) => [p.lat, p.lng] as [number, number])), { padding: [32, 32], maxZoom: 15 });
    })().catch((err) => console.error('map not shown:', err instanceof Error ? err.message : err));
    return () => {
      gone = true;
      map?.remove();
    };
    // Redrawn only when the pins change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return <div ref={box} className={`${styles.map} ${className}`} role="region" aria-label={label} />;
}
