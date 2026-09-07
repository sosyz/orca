import type { ComponentBuilderContext, RNOHPackage, RNPackageContext, } from '@rnoh/react-native-openharmony';
import { AsyncStoragePackage } from '@react-native-oh-tpl/async-storage';
import GestureHandlerPackage from '@react-native-oh-tpl/react-native-gesture-handler';
import { ReanimatedPackage } from '@react-native-oh-tpl/react-native-reanimated/src/main/ets/ReanimatedPackage';
import { SafeAreaViewPackage } from '@react-native-oh-tpl/react-native-safe-area-context';
import { SvgPackage } from '@react-native-oh-tpl/react-native-svg';
import { WebView, WebViewPackage } from '@react-native-oh-tpl/react-native-webview';
import { OrcaHarmonyPackage } from './native/OrcaHarmonyPackage';

@Builder
function buildHarmonyWebView(ctx: ComponentBuilderContext) {
  WebView({
    ctx: ctx.rnComponentContext,
    tag: ctx.tag,
  });
}

class HarmonyAsyncStoragePackage extends AsyncStoragePackage {
  createWrappedCustomRNComponentBuilderByComponentNameMap(): Map<string, WrappedBuilder<[ComponentBuilderContext]>> {
    return new Map();
  }
}

class HarmonyGestureHandlerPackage extends GestureHandlerPackage {
  createWrappedCustomRNComponentBuilderByComponentNameMap(): Map<string, WrappedBuilder<[ComponentBuilderContext]>> {
    return new Map();
  }
}

class HarmonyReanimatedPackage extends ReanimatedPackage {
  createWrappedCustomRNComponentBuilderByComponentNameMap(): Map<string, WrappedBuilder<[ComponentBuilderContext]>> {
    return new Map();
  }
}

class HarmonySafeAreaViewPackage extends SafeAreaViewPackage {
  createWrappedCustomRNComponentBuilderByComponentNameMap(): Map<string, WrappedBuilder<[ComponentBuilderContext]>> {
    return new Map();
  }
}

class HarmonySvgPackage extends SvgPackage {
  createWrappedCustomRNComponentBuilderByComponentNameMap(): Map<string, WrappedBuilder<[ComponentBuilderContext]>> {
    return new Map();
  }
}

class HarmonyWebViewPackage extends WebViewPackage {
  override createWrappedCustomRNComponentBuilderByComponentNameMap(): Map<string,
  WrappedBuilder<[ComponentBuilderContext]>> {
    return new Map<string, WrappedBuilder<[ComponentBuilderContext]>>()
      .set(WebView.NAME, wrapBuilder(buildHarmonyWebView));
  }
}

export function getRNOHPackages(context: RNPackageContext): RNOHPackage[] {
  return [
    new OrcaHarmonyPackage(context),
    new HarmonyAsyncStoragePackage(context),
    new HarmonyGestureHandlerPackage(context),
    new HarmonyReanimatedPackage(context),
    new HarmonySafeAreaViewPackage(context),
    new HarmonySvgPackage(context),
    new HarmonyWebViewPackage(context),
  ];
}
