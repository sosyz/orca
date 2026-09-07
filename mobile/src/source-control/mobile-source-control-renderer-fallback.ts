import type { MobileGitStatusEntry } from './mobile-git-status'
import { buildMobileReviewFileRoute } from './mobile-review-route'

type RpcErrorShape = {
  code?: string
  message?: string
}

const RENDERER_UNAVAILABLE_MESSAGE = 'renderer_unavailable'

type RendererFallbackRouter = {
  push: (route: string) => void
  replace: (route: string) => void
}

type NavigateMobileOpenDiffRendererFallbackOptions = {
  router: RendererFallbackRouter
  hostId: string
  worktreeId: string
  worktreeName: string
  entry: Pick<MobileGitStatusEntry, 'path' | 'area'>
  embedded: boolean
  onRequestClose?: () => void
}

export function isMobileOpenDiffRendererUnavailable(error: RpcErrorShape | undefined): boolean {
  return (
    error?.code === RENDERER_UNAVAILABLE_MESSAGE ||
    (error?.code === 'runtime_error' && error.message === RENDERER_UNAVAILABLE_MESSAGE)
  )
}

export function navigateMobileOpenDiffRendererFallback(
  options: NavigateMobileOpenDiffRendererFallbackOptions
): void {
  const route = buildMobileReviewFileRoute({
    hostId: options.hostId,
    worktreeId: options.worktreeId,
    worktreeName: options.worktreeName,
    filePath: options.entry.path,
    area: options.entry.area
  })

  // Why: pushed session panels should not stay between Review and the session;
  // docked panels have no route to replace, so close them after pushing Review.
  if (options.embedded) {
    options.router.push(route)
    options.onRequestClose?.()
  } else {
    options.router.replace(route)
  }
}
