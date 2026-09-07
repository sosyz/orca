export const MOBILE_CODE_TEXT_SCALE_MIN = 0.8
export const MOBILE_CODE_TEXT_SCALE_MAX = 2
export const MOBILE_CODE_TEXT_SCALE_STEP = 0.1

export type MobileCodeTouchPoint = {
  pageX?: number
  pageY?: number
  locationX?: number
  locationY?: number
}

export function clampMobileCodeTextScale(scale: number): number {
  if (!Number.isFinite(scale)) {
    return 1
  }
  return Math.min(MOBILE_CODE_TEXT_SCALE_MAX, Math.max(MOBILE_CODE_TEXT_SCALE_MIN, scale))
}

export function quantizeMobileCodeTextScale(scale: number): number {
  const clamped = clampMobileCodeTextScale(scale)
  const stepIndex = Math.floor(clamped / MOBILE_CODE_TEXT_SCALE_STEP + 0.5 + 1e-9)
  const stepped = stepIndex * MOBILE_CODE_TEXT_SCALE_STEP
  return clampMobileCodeTextScale(Number(stepped.toFixed(2)))
}

export function stepMobileCodeTextScale(scale: number, direction: -1 | 1): number {
  return quantizeMobileCodeTextScale(scale + direction * MOBILE_CODE_TEXT_SCALE_STEP)
}

export function mobileCodePinchDistance(
  touches: readonly MobileCodeTouchPoint[] | undefined
): number | null {
  if (!touches || touches.length < 2) {
    return null
  }
  const [first, second] = touches
  if (!first || !second) {
    return null
  }
  const firstPoint = readMobileCodeTouchPoint(first)
  const secondPoint = readMobileCodeTouchPoint(second)
  if (!firstPoint || !secondPoint) {
    return null
  }
  const distance = Math.hypot(firstPoint.x - secondPoint.x, firstPoint.y - secondPoint.y)
  return distance >= 8 ? distance : null
}

export function mobileCodeScaleFromPinch(
  baseScale: number,
  baseDistance: number,
  currentDistance: number
): number {
  if (baseDistance <= 0 || currentDistance <= 0) {
    return quantizeMobileCodeTextScale(baseScale)
  }
  return quantizeMobileCodeTextScale((baseScale * currentDistance) / baseDistance)
}

export function scaledMobileCodeTextMetrics(
  baseFontSize: number,
  baseLineHeight: number,
  scale: number
): { fontSize: number; lineHeight: number } {
  const normalized = clampMobileCodeTextScale(scale)
  return {
    fontSize: Number((baseFontSize * normalized).toFixed(2)),
    lineHeight: Number((baseLineHeight * normalized).toFixed(2))
  }
}

export function scaledMobileCodeGutterWidth(baseWidth: number, scale: number): number {
  const scaledWidth = Number((baseWidth * clampMobileCodeTextScale(scale)).toFixed(2))
  return Math.max(baseWidth, scaledWidth)
}

function readMobileCodeTouchPoint(touch: MobileCodeTouchPoint): { x: number; y: number } | null {
  const x = Number.isFinite(touch.pageX) ? touch.pageX : touch.locationX
  const y = Number.isFinite(touch.pageY) ? touch.pageY : touch.locationY
  return typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y)
    ? { x, y }
    : null
}
