import type { common } from '@kit.AbilityKit';
import { abilityAccessCtrl, bundleManager, type Permissions } from '@kit.AbilityKit';

export class HarmonyPermissionService {
  private readonly manager = abilityAccessCtrl.createAtManager();
  private readonly context: common.UIAbilityContext;
  private readonly tokenId: number;

  constructor(context: common.UIAbilityContext) {
    this.context = context;
    const bundleInfo = bundleManager.getBundleInfoForSelfSync(
      bundleManager.BundleFlag.GET_BUNDLE_INFO_WITH_APPLICATION,
    );
    this.tokenId = bundleInfo.appInfo.accessTokenId;
  }

  isGranted(name: string): boolean {
    const permission = name as Permissions;
    return this.manager.checkAccessTokenSync(this.tokenId, permission) ===
    abilityAccessCtrl.GrantStatus.PERMISSION_GRANTED;
  }

  async request(name: string): Promise<boolean> {
    if (this.isGranted(name)) {
      return true;
    }
    const permission = name as Permissions;
    const result = await this.manager.requestPermissionsFromUser(this.context, [permission]);
    return result.authResults[0] === abilityAccessCtrl.GrantStatus.PERMISSION_GRANTED;
  }
}
