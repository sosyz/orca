import { AbilityConstant, type Want } from '@kit.AbilityKit';
import { RNAbility } from '@rnoh/react-native-openharmony';
import { HarmonyAppLifecycle } from '../native/HarmonyAppLifecycle';
import { HarmonyLinkingState } from '../native/HarmonyLinkingState';
import { HarmonyNotificationState } from '../native/HarmonyNotificationState';

export default class EntryAbility extends RNAbility {
  override onCreate(want: Want, launchParam?: AbilityConstant.LaunchParam): void {
    super.onCreate(want, launchParam);
    HarmonyLinkingState.receiveInitialWant(want);
    HarmonyNotificationState.receiveWant(want);
  }

  override onNewWant(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    super.onNewWant(want, launchParam);
    HarmonyLinkingState.receiveNewWant(want);
    HarmonyNotificationState.receiveWant(want);
  }

  override onForeground(): void {
    super.onForeground();
    HarmonyAppLifecycle.enterForeground();
  }

  override onBackground(): void {
    super.onBackground();
    HarmonyAppLifecycle.enterBackground();
  }

  override getPagePath(): string {
    return 'pages/Index';
  }
}
