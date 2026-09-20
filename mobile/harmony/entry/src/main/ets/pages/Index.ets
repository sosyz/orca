import {
  AnyJSBundleProvider,
  MetroJSBundleProvider,
  ResourceJSBundleProvider,
  RNApp,
  RNOHCoreContext,
  RNOHErrorDialog,
  TraceJSBundleProviderDecorator
} from '@rnoh/react-native-openharmony';
import { getRNOHPackages } from '../PackageProvider';

@Entry
@Component
struct Index {
  @StorageLink('RNOHCoreContext') private rnohCoreContext: RNOHCoreContext | undefined = undefined;

  onBackPress(): boolean {
    this.rnohCoreContext?.dispatchBackPress();
    return true;
  }

  build() {
    Column() {
      if (this.rnohCoreContext) {
        if (this.rnohCoreContext.isDebugModeEnabled) {
          RNOHErrorDialog({ ctx: this.rnohCoreContext });
        }
        RNApp({
          rnInstanceConfig: {
            name: 'orca-mobile',
            createRNPackages: getRNOHPackages,
            fontResourceByFontFamily: {
              'MesloLGS NF': $rawfile('fonts/MesloLGS-NF-Regular.ttf'),
              'Orca Emoji': $rawfile('fonts/Noto-COLRv1.ttf')
            },
            enableDebugger: this.rnohCoreContext.isDebugModeEnabled
          },
          appKey: 'OrcaMobile',
          jsBundleProvider: new TraceJSBundleProviderDecorator(
            this.rnohCoreContext.isDebugModeEnabled ?
              new AnyJSBundleProvider([
                new MetroJSBundleProvider(),
                new ResourceJSBundleProvider(
                  this.rnohCoreContext.uiAbilityContext.resourceManager,
                  'hermes_bundle.hbc'
                )
              ]) :
              new ResourceJSBundleProvider(
                this.rnohCoreContext.uiAbilityContext.resourceManager,
                'hermes_bundle.hbc'
              ),
            this.rnohCoreContext.logger
          )
        });
      }
    }
    .height('100%')
    .width('100%')
  }
}
