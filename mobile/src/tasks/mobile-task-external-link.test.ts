import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { readMobileTasksSourceFamily } from './mobile-tasks-source-family.test-support'
import {
  MOBILE_TASK_EXTERNAL_LINK_FAILURE_MESSAGE,
  MOBILE_TASK_EXTERNAL_LINK_FAILURE_TITLE,
  openMobileTaskExternalLink
} from './mobile-task-external-link'

describe('openMobileTaskExternalLink', () => {
  it('reports a generic failure for synchronous opener errors', async () => {
    const secretUrl = 'https://github.example/acme/repo/pull/1?token=secret'
    const showFailure = vi.fn()

    await openMobileTaskExternalLink({
      url: secretUrl,
      openURL: () => {
        throw new Error(`native rejected ${secretUrl}`)
      },
      showFailure
    })

    expect(showFailure).toHaveBeenCalledWith(
      MOBILE_TASK_EXTERNAL_LINK_FAILURE_TITLE,
      MOBILE_TASK_EXTERNAL_LINK_FAILURE_MESSAGE
    )
    expect(showFailure.mock.calls.flat().join(' ')).not.toContain('token=secret')
  })

  it('reports a generic failure for rejected opener promises', async () => {
    const showFailure = vi.fn()

    await openMobileTaskExternalLink({
      url: 'https://linear.example/issue/APP-1?viewer=secret',
      openURL: () => Promise.reject(new Error('permission denied')),
      showFailure
    })

    expect(showFailure).toHaveBeenCalledTimes(1)
    expect(showFailure.mock.calls[0]).toEqual([
      MOBILE_TASK_EXTERNAL_LINK_FAILURE_TITLE,
      MOBILE_TASK_EXTERNAL_LINK_FAILURE_MESSAGE
    ])
  })

  it('keeps successful opens silent', async () => {
    const openURL = vi.fn().mockResolvedValue(undefined)
    const showFailure = vi.fn()

    await openMobileTaskExternalLink({
      url: 'https://github.example/acme/repo/issues/2',
      openURL,
      showFailure
    })

    expect(openURL).toHaveBeenCalledWith('https://github.example/acme/repo/issues/2')
    expect(showFailure).not.toHaveBeenCalled()
  })

  it('does not report after the Tasks screen unmounts', async () => {
    const showFailure = vi.fn()

    await openMobileTaskExternalLink({
      url: 'https://gitlab.example/acme/repo/-/jobs/7',
      openURL: () => Promise.reject(new Error('activity closed')),
      showFailure,
      isMounted: () => false
    })

    expect(showFailure).not.toHaveBeenCalled()
  })

  it('does not report after the Tasks route switches host before rejection', async () => {
    const showFailure = vi.fn()
    const requestedHostId = 'host-a'
    let currentHostId = requestedHostId

    await openMobileTaskExternalLink({
      url: 'https://github.example/acme/repo/actions/runs/9',
      openURL: () => {
        currentHostId = 'host-b'
        return Promise.reject(new Error('activity closed'))
      },
      showFailure,
      isMounted: () => currentHostId === requestedHostId
    })

    expect(showFailure).not.toHaveBeenCalled()
  })
})

describe('Tasks external link wiring', () => {
  const tasksSource = readMobileTasksSourceFamily()
  const hookSource = readFileSync(
    new URL('./use-mobile-task-external-link.ts', import.meta.url),
    'utf8'
  )

  it('routes every Tasks external link opener through the guarded handler', () => {
    expect(tasksSource).not.toContain('void Linking.openURL')
    expect(tasksSource.match(/void model\.openExternalTaskUrl\(/g) ?? []).toHaveLength(9)
    expect(tasksSource).toContain('const openExternalTaskUrl = useMobileTaskExternalLink(hostId)')
    expect(hookSource).toContain('useLayoutEffect(() => {')
    expect(hookSource).toContain('openMobileTaskExternalLink({')
    expect(hookSource).toContain('Alert.alert(title, message)')
    expect(hookSource).toContain('const requestedScope = scopeRef.current')
    expect(hookSource).toContain('scopeRef.current === requestedScope')
  })
})
