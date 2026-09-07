import { describe, expect, it } from 'vitest'
import {
  MOBILE_CODE_TEXT_SCALE_MAX,
  MOBILE_CODE_TEXT_SCALE_MIN,
  clampMobileCodeTextScale,
  mobileCodePinchDistance,
  mobileCodeScaleFromPinch,
  quantizeMobileCodeTextScale,
  scaledMobileCodeGutterWidth,
  scaledMobileCodeTextMetrics,
  stepMobileCodeTextScale
} from './mobile-code-text-scale'

describe('mobile code text scale', () => {
  it('quantizes text scale and clamps invalid or out-of-range values', () => {
    expect(quantizeMobileCodeTextScale(1.04)).toBe(1)
    expect(quantizeMobileCodeTextScale(1.06)).toBe(1.1)
    expect(quantizeMobileCodeTextScale(1.45)).toBe(1.5)
    expect(quantizeMobileCodeTextScale(10)).toBe(MOBILE_CODE_TEXT_SCALE_MAX)
    expect(quantizeMobileCodeTextScale(0.1)).toBe(MOBILE_CODE_TEXT_SCALE_MIN)
    expect(clampMobileCodeTextScale(Number.NaN)).toBe(1)
  })

  it('steps buttons without crossing the supported bounds', () => {
    expect(stepMobileCodeTextScale(1, 1)).toBe(1.1)
    expect(stepMobileCodeTextScale(1, -1)).toBe(0.9)
    expect(stepMobileCodeTextScale(MOBILE_CODE_TEXT_SCALE_MAX, 1)).toBe(MOBILE_CODE_TEXT_SCALE_MAX)
    expect(stepMobileCodeTextScale(MOBILE_CODE_TEXT_SCALE_MIN, -1)).toBe(MOBILE_CODE_TEXT_SCALE_MIN)
  })

  it('derives a two-finger pinch ratio and ignores incomplete touches', () => {
    expect(
      mobileCodePinchDistance([
        { pageX: 10, pageY: 20 },
        { pageX: 110, pageY: 20 }
      ])
    ).toBe(100)
    expect(mobileCodePinchDistance([{ pageX: 10, pageY: 20 }])).toBeNull()
    expect(
      mobileCodePinchDistance([
        { locationX: 10, locationY: 20 },
        { locationX: 110, locationY: 20 }
      ])
    ).toBe(100)
    expect(
      mobileCodePinchDistance([
        { pageX: Number.NaN, pageY: 20 },
        { pageX: 110, pageY: 20 }
      ])
    ).toBeNull()
    expect(mobileCodeScaleFromPinch(1, 100, 155)).toBe(1.6)
    expect(mobileCodeScaleFromPinch(1, 100, 40)).toBe(MOBILE_CODE_TEXT_SCALE_MIN)
  })

  it('scales font size and line height together so text does not overlap', () => {
    expect(scaledMobileCodeTextMetrics(13, 19, 1.5)).toEqual({
      fontSize: 19.5,
      lineHeight: 28.5
    })
    expect(scaledMobileCodeGutterWidth(42, 0.8)).toBe(42)
    expect(scaledMobileCodeGutterWidth(42, 2)).toBe(84)
  })
})
