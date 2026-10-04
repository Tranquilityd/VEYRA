// Veyra — device capability detection (single source of truth)
export const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
export const isCoarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
// "mobile-like": touch + coarse pointer. Desktops never match, even in portrait windows.
export const isMobileLike = isTouch && isCoarse;

export function isPortrait() {
  if (typeof matchMedia !== 'undefined' && matchMedia('(orientation: portrait)').matches) return true;
  return window.innerHeight > window.innerWidth;
}
