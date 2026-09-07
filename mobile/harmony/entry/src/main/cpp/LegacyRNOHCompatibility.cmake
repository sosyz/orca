function(replace_legacy_rnoh_source file_path old_source new_source)
  file(READ "${file_path}" file_contents)
  string(FIND "${file_contents}" "${new_source}" replacement_index)
  if(NOT replacement_index EQUAL -1)
    return()
  endif()

  string(FIND "${file_contents}" "${old_source}" source_index)
  if(source_index EQUAL -1)
    message(FATAL_ERROR "Unsupported native dependency source: ${file_path}")
  endif()

  string(REPLACE "${old_source}" "${new_source}" file_contents "${file_contents}")
  file(WRITE "${file_path}" "${file_contents}")
endfunction()

set(SVG_CPP_DIR "${OH_MODULES_DIR}/@react-native-oh-tpl/react-native-svg/src/main/cpp")

replace_legacy_rnoh_source(
  "${SVG_CPP_DIR}/componentInstances/RNSVGForeignObjectComponentInstance.cpp"
  [=[#include "RNSVGForeignObjectComponentInstance.h"]=]
  [=[#include "RNSVGForeignObjectComponentInstance.h"
#include "RNOH/arkui/NativeNodeApi.h"]=]
)

replace_legacy_rnoh_source(
  "${SVG_CPP_DIR}/svgImage/RNSVGImageComponentDescriptor.h"
  [=[    void adopt(ShadowNode::Unshared const &shadowNode) const override {
        ConcreteComponentDescriptor::adopt(shadowNode);

        auto imageShadowNode = std::static_pointer_cast<RNSVGImageShadowNode>(shadowNode);

        // `RNSVGImageShadowNode` uses `ImageManager` to initiate image loading and
        // communicate the loading state and results to mounting layer.
        imageShadowNode->setImageManager(imageManager_);
    }]=]
  [=[    void adopt(ShadowNode &shadowNode) const override {
        ConcreteComponentDescriptor::adopt(shadowNode);

        auto &imageShadowNode = static_cast<RNSVGImageShadowNode &>(shadowNode);

        // `RNSVGImageShadowNode` uses `ImageManager` to initiate image loading and
        // communicate the loading state and results to mounting layer.
        imageShadowNode.setImageManager(imageManager_);
    }]=]
)

replace_legacy_rnoh_source(
  "${SVG_CPP_DIR}/svgImage/RNSVGImageShadowNode.h"
  [=[    static RNSVGImageState initialStateData(ShadowNodeFragment const &fragment,
                                            ShadowNodeFamilyFragment const &familyFragment,
                                            ComponentDescriptor const &componentDescriptor) {]=]
  [=[    static RNSVGImageState initialStateData(Props::Shared const &props,
                                            ShadowNodeFamily::Shared const &family,
                                            ComponentDescriptor const &componentDescriptor) {]=]
)
