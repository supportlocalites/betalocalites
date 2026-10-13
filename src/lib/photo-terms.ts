/** Business photos: the numbers both the page and the server use (the database says 8 too: vendor_photo_limit()). */
export const PHOTO_LIMIT = 8;
export const DESCRIPTION_MAX = 200;

/** Every photo frame's shape: 4:3, a little wider than tall (product owner, 13 October 2026). */

/** Where a photo sits in its frame (CSS object-position): the spot the owner tapped stays in view. */
export const framePosition = (p: { focusX: number; focusY: number }) =>
  `${Math.round(p.focusX * 1000) / 10}% ${Math.round(p.focusY * 1000) / 10}%`;

/** How wide the owner's "tap what matters" photo is drawn, in CSS pixels (tokens.css: --size-photo-picker). */
export const PICKER_WIDTH = 280;
