/**
 * Zoom utility functions matching Bandage's zoom implementation
 * References: BandageNG/program/settings.cpp lines 61-63
 */

// Bandage zoom constants
export const MIN_ZOOM = 0.001 // 0.1%
export const MAX_ZOOM = 100.0 // 10,000%
export const ZOOM_SLIDER_MIN = Math.log10(MIN_ZOOM)
export const ZOOM_SLIDER_MAX = Math.log10(MAX_ZOOM)
export const ZOOM_SLIDER_STEP = 0.01

/**
 * Clamp zoom value to Bandage's min/max range
 */
export function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom))
}

/**
 * Format zoom value as percentage string
 */
export function formatZoomPercent(zoom: number): string {
  return `${(zoom * 100).toFixed(1)}%`
}

/**
 * Convert zoom to a logarithmic slider value. A linear slider over 0.001-100
 * makes normal fit-view zoom levels unusably cramped near the left edge.
 */
export function zoomToSliderValue(zoom: number): number {
  return Math.log10(clampZoom(zoom))
}

/**
 * Convert logarithmic slider value back to the real canvas zoom scale.
 */
export function sliderValueToZoom(sliderValue: number): number {
  return clampZoom(10 ** sliderValue)
}
