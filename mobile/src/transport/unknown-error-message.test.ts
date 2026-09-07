import { describe, expect, it } from 'vitest'
import { formatUnknownErrorMessage } from './unknown-error-message'

describe('formatUnknownErrorMessage', () => {
  it('extracts meaningful messages from errors, strings, and bridge rejection objects', () => {
    expect(formatUnknownErrorMessage(new Error('socket closed'), 'fallback')).toBe('socket closed')
    expect(formatUnknownErrorMessage('  connection refused  ', 'fallback')).toBe(
      'connection refused'
    )
    expect(formatUnknownErrorMessage({ code: 5, message: 'permission denied' }, 'fallback')).toBe(
      'permission denied'
    )
  })

  it('uses the fallback for opaque or hostile values', () => {
    expect(formatUnknownErrorMessage({}, 'fallback')).toBe('fallback')
    expect(formatUnknownErrorMessage(null, 'fallback')).toBe('fallback')
    expect(formatUnknownErrorMessage(42, 'fallback')).toBe('fallback')
    expect(
      formatUnknownErrorMessage(
        new Proxy(
          {},
          {
            get() {
              throw new Error('do not inspect')
            }
          }
        ),
        'fallback'
      )
    ).toBe('fallback')
  })
})
