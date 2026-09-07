#include "ReactNativeCompatibility.h"
#include "AsyncStoragePackage.h"
#include "GestureHandlerPackage.h"
#include "ReanimatedPackage.h"
#include "RNOH/PackageProvider.h"
#include "SVGPackage.h"
#include "SafeAreaViewPackage.h"
#include "WebViewPackage.h"
#include "generated/RNOHGeneratedPackage.h"

using namespace rnoh;

std::vector<std::shared_ptr<Package>> PackageProvider::getPackages(Package::Context ctx) {
  return {
    std::make_shared<RNOHGeneratedPackage>(ctx),
    std::make_shared<AsyncStoragePackage>(ctx),
    std::make_shared<GestureHandlerPackage>(ctx),
    std::make_shared<ReanimatedPackage>(ctx),
    std::make_shared<SafeAreaViewPackage>(ctx),
    std::make_shared<SVGPackage>(ctx),
    std::make_shared<WebViewPackage>(ctx),
  };
}
