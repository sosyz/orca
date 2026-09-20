import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMobileSourceControlRunners } from './use-mobile-source-control-runners'

const mocks = vi.hoisted(() => ({ triggerSuccess: vi.fn(), triggerError: vi.fn() }))

vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('../platform/haptics', () => ({
  triggerSuccess: mocks.triggerSuccess,
  triggerError: mocks.triggerError
}))
vi.mock('./use-mobile-commit-message-generation', () => ({
  useMobileCommitMessageGeneration: () => ({
    generateCommitMessage: vi.fn(),
    cancelGenerateCommitMessage: vi.fn()
  })
}))
vi.mock('./use-mobile-source-control-commit-runners', () => ({
  useMobileSourceControlCommitRunners: () => ({
    commit: vi.fn(),
    runCommitSequence: vi.fn(),
    runCommitSyncSequence: vi.fn()
  })
}))
vi.mock('./use-mobile-source-control-action-sheet-runners', () => ({
  useMobileSourceControlActionSheetRunners: () => ({})
}))
vi.mock('./use-mobile-create-pr-runner', () => ({ useMobileCreatePrRunner: () => vi.fn() }))

type Runners = ReturnType<typeof useMobileSourceControlRunners>
type RunnerParams = Parameters<typeof useMobileSourceControlRunners>[0]

function runnerParams(overrides: Partial<RunnerParams> = {}): RunnerParams {
  return {
    client: null,
    connState: 'connected',
    hostId: 'host',
    worktreeId: 'first',
    status: null,
    branchLabel: '',
    commitMessage: '',
    stagedEntries: [],
    generatingMessage: false,
    stageablePaths: [],
    unstageablePaths: [],
    router: { push: vi.fn() } as never,
    sendGitRequest: vi.fn(),
    sendCommitRequest: vi.fn(),
    runGitSyncSteps: vi.fn(),
    loadStatus: vi.fn(),
    mountedRef: { current: true },
    busyActionRef: { current: null },
    setBusyAction: vi.fn(),
    setActionError: vi.fn(),
    setCommitMessage: vi.fn(),
    setGeneratingMessage: vi.fn(),
    setShowActionSheet: vi.fn(),
    setLocalBranches: vi.fn(),
    setShowBranchPicker: vi.fn(),
    setCreatedPrUrl: vi.fn(),
    setCreatedPrWarning: vi.fn(),
    recordCommitFailure: vi.fn(),
    ...overrides
  }
}

describe('source-control action scope', () => {
  let renderer: ReactTestRenderer | null = null
  let runners: Runners | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    runners = null
    mocks.triggerSuccess.mockClear()
    mocks.triggerError.mockClear()
  })

  it('does not send an old confirmation action after its panel unmounts', async () => {
    const sendGitRequest = vi.fn().mockResolvedValue({})
    const mountedRef = { current: true }
    const busyActionRef = { current: null }
    function Harness() {
      runners = useMobileSourceControlRunners(
        runnerParams({ sendGitRequest, mountedRef, busyActionRef })
      )
      return null
    }
    act(() => {
      renderer = create(createElement(Harness))
    })
    const oldRunGitAction = runners!.runGitAction
    act(() => renderer?.unmount())

    await act(async () => {
      await oldRunGitAction('discard:same.txt', 'git.discard', { filePath: 'same.txt' })
    })
    expect(sendGitRequest).not.toHaveBeenCalled()
  })

  it('ignores a completed action after the same panel adopts a new worktree', async () => {
    let finishRequest: (() => void) | null = null
    const sendGitRequest = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRequest = resolve
        })
    )
    const loadStatus = vi.fn()
    const setActionError = vi.fn()
    const setBusyAction = vi.fn()
    const mountedRef = { current: true }
    const busyActionRef = { current: null }
    function Harness({ worktreeId }: { worktreeId: string }) {
      runners = useMobileSourceControlRunners(
        runnerParams({
          client: { sendRequest: vi.fn() } as never,
          worktreeId,
          sendGitRequest,
          loadStatus,
          setActionError,
          setBusyAction,
          mountedRef,
          busyActionRef
        })
      )
      return null
    }
    act(() => {
      renderer = create(createElement(Harness, { worktreeId: 'first' }))
    })
    let action: Promise<boolean> | null = null
    act(() => {
      action = runners!.runGitAction('discard:same.txt', 'git.discard', { filePath: 'same.txt' })
    })
    act(() => {
      renderer!.update(createElement(Harness, { worktreeId: 'second' }))
    })
    await act(async () => {
      finishRequest?.()
      await action
    })

    expect(loadStatus).not.toHaveBeenCalled()
    expect(mocks.triggerSuccess).not.toHaveBeenCalled()
    expect(setBusyAction.mock.calls).toEqual([['discard:same.txt'], [null]])
  })
})
