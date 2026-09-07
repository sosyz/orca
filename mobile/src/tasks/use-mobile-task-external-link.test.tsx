import { createElement, StrictMode, useEffect } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMobileTaskExternalLink } from './use-mobile-task-external-link'

const reactNativeMock = vi.hoisted(() => ({
  alert: vi.fn(),
  openURL: vi.fn()
}))

vi.mock('react-native', () => ({
  Alert: { alert: reactNativeMock.alert },
  Linking: { openURL: reactNativeMock.openURL }
}))

type OpenTaskExternalLink = (url: string) => Promise<void>

function deferredPromise(): {
  promise: Promise<void>
  reject: (error: unknown) => void
} {
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((_resolve, rejectPromise) => {
    reject = rejectPromise
  })
  return { promise, reject }
}

function HookHarness({
  hostId,
  onReady
}: {
  hostId: string
  onReady: (open: OpenTaskExternalLink) => void
}) {
  const open = useMobileTaskExternalLink(hostId)

  useEffect(() => {
    onReady(open)
  }, [onReady, open])

  return null
}

async function renderHarness(
  hostId: string,
  options: { strict?: boolean } = {}
): Promise<{
  renderer: ReactTestRenderer
  setHostId: (nextHostId: string) => void
  open: () => OpenTaskExternalLink
}> {
  let renderer: ReactTestRenderer
  let currentOpen: OpenTaskExternalLink | null = null
  const onReady = (open: OpenTaskExternalLink): void => {
    currentOpen = open
  }
  const render = (nextHostId: string) => {
    const element = createElement(HookHarness, { hostId: nextHostId, onReady })
    return options.strict ? createElement(StrictMode, null, element) : element
  }

  await act(async () => {
    renderer = create(render(hostId))
    await Promise.resolve()
  })

  return {
    renderer: renderer!,
    setHostId: (nextHostId: string) => {
      renderer!.update(render(nextHostId))
    },
    open: () => {
      if (!currentOpen) {
        throw new Error('open handler not ready')
      }
      return currentOpen
    }
  }
}

afterEach(() => {
  reactNativeMock.alert.mockReset()
  reactNativeMock.openURL.mockReset()
})

describe('useMobileTaskExternalLink', () => {
  it('shows a generic visible alert when the opener rejects', async () => {
    reactNativeMock.openURL.mockRejectedValueOnce(new Error('native includes ?token=secret'))
    const harness = await renderHarness('host-a')

    await act(async () => {
      await harness.open()('https://github.example/acme/repo/pull/1?token=secret')
    })

    expect(reactNativeMock.alert).toHaveBeenCalledWith(
      "Couldn't open link",
      'Try again, or open the link from desktop Orca.'
    )
    expect(reactNativeMock.alert.mock.calls.flat().join(' ')).not.toContain('token=secret')
  })

  it('keeps successful opens silent', async () => {
    reactNativeMock.openURL.mockResolvedValueOnce(undefined)
    const harness = await renderHarness('host-a')

    await act(async () => {
      await harness.open()('https://github.example/acme/repo/issues/2')
    })

    expect(reactNativeMock.openURL).toHaveBeenCalledWith(
      'https://github.example/acme/repo/issues/2'
    )
    expect(reactNativeMock.alert).not.toHaveBeenCalled()
  })

  it('drops late failures after the route switches host', async () => {
    const pending = deferredPromise()
    reactNativeMock.openURL.mockReturnValueOnce(pending.promise)
    const harness = await renderHarness('host-a')
    const open = harness.open()
    const openResult = open('https://gitlab.example/acme/repo/-/jobs/7')

    await act(async () => {
      harness.setHostId('host-b')
      await Promise.resolve()
    })
    pending.reject(new Error('activity closed'))
    await act(async () => {
      await openResult
    })

    expect(reactNativeMock.alert).not.toHaveBeenCalled()
  })

  it('drops late failures after the route switches from host A to B and back to A', async () => {
    const pending = deferredPromise()
    reactNativeMock.openURL.mockReturnValueOnce(pending.promise)
    const harness = await renderHarness('host-a')
    const open = harness.open()
    const openResult = open('https://github.example/acme/repo/actions/runs/9')

    await act(async () => {
      harness.setHostId('host-b')
      await Promise.resolve()
    })
    await act(async () => {
      harness.setHostId('host-a')
      await Promise.resolve()
    })
    pending.reject(new Error('activity closed'))
    await act(async () => {
      await openResult
    })

    expect(reactNativeMock.alert).not.toHaveBeenCalled()
  })

  it('keeps the active StrictMode scope mounted after lifecycle replay', async () => {
    reactNativeMock.openURL.mockRejectedValueOnce(new Error('native includes ?token=secret'))
    const harness = await renderHarness('host-a', { strict: true })

    await act(async () => {
      await harness.open()('https://github.example/acme/repo/pull/1?token=secret')
    })

    expect(reactNativeMock.alert).toHaveBeenCalledWith(
      "Couldn't open link",
      'Try again, or open the link from desktop Orca.'
    )
  })

  it('drops late failures after a StrictMode screen unmount', async () => {
    const pending = deferredPromise()
    reactNativeMock.openURL.mockReturnValueOnce(pending.promise)
    const harness = await renderHarness('host-a', { strict: true })
    const openResult = harness.open()('https://gitlab.example/acme/repo/-/jobs/7')

    act(() => {
      harness.renderer.unmount()
    })
    pending.reject(new Error('activity closed'))
    await act(async () => {
      await openResult
    })

    expect(reactNativeMock.alert).not.toHaveBeenCalled()
  })
})
