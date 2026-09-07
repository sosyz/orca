export const MOBILE_TASK_EXTERNAL_LINK_FAILURE_TITLE = "Couldn't open link"
export const MOBILE_TASK_EXTERNAL_LINK_FAILURE_MESSAGE =
  'Try again, or open the link from desktop Orca.'

type MobileTaskExternalLinkOptions = {
  url: string
  openURL: (url: string) => Promise<unknown> | unknown
  showFailure: (title: string, message: string) => void
  isMounted?: () => boolean
}

export async function openMobileTaskExternalLink({
  url,
  openURL,
  showFailure,
  isMounted = () => true
}: MobileTaskExternalLinkOptions): Promise<void> {
  try {
    await openURL(url)
  } catch {
    if (isMounted()) {
      showFailure(
        MOBILE_TASK_EXTERNAL_LINK_FAILURE_TITLE,
        MOBILE_TASK_EXTERNAL_LINK_FAILURE_MESSAGE
      )
    }
  }
}
