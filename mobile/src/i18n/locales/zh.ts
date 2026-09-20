import { mergeMobileLocaleDomains } from './catalog'
import about from './zh/about'
import browser from './zh/browser'
import common from './zh/common'
import home from './zh/home'
import notifications from './zh/notifications'
import onboarding from './zh/onboarding'
import pairing from './zh/pairing'
import session from './zh/session'
import settings from './zh/settings'
import workspace from './zh/workspace'

const zh = mergeMobileLocaleDomains(
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

export default zh
