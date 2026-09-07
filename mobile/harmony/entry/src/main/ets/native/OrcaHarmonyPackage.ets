import type {
  ComponentBuilderContext,
  UITurboModule,
  UITurboModuleContext,
} from '@rnoh/react-native-openharmony';
import { RNOHPackage } from '@rnoh/react-native-openharmony';
import { OrcaHarmonyTurboModule } from './OrcaHarmonyTurboModule';

export class OrcaHarmonyPackage extends RNOHPackage {
  override getUITurboModuleFactoryByNameMap(): Map<string,
  (ctx: UITurboModuleContext) => UITurboModule | null> {
    return new Map<string, (ctx: UITurboModuleContext) => UITurboModule>()
      .set(OrcaHarmonyTurboModule.NAME, (ctx) => new OrcaHarmonyTurboModule(ctx));
  }

  override createWrappedCustomRNComponentBuilderByComponentNameMap(): Map<string,
  WrappedBuilder<[ComponentBuilderContext]>> {
    return new Map();
  }
}
