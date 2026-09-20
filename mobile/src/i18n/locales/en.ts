import { mergeMobileLocaleDomains } from './catalog'
import about from './en/about'
import browser from './en/browser'
import common from './en/common'
import home from './en/home'
import notifications from './en/notifications'
import onboarding from './en/onboarding'
import pairing from './en/pairing'
import session from './en/session'
import settings from './en/settings'
import workspace from './en/workspace'

const en = mergeMobileLocaleDomains(
  common,
  settings,
  home,
  pairing,
  onboarding,
  notifications,
  browser,
  about,
  session,
  workspace
)

export default en
