cmake_minimum_required(VERSION 3.11)
project(orca_mobile)

set(RNOH_APP_DIR "${CMAKE_CURRENT_SOURCE_DIR}")
set(NODE_MODULES "${CMAKE_CURRENT_SOURCE_DIR}/../../../../node_modules")
set(RNOH_CPP_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../../../oh_modules/@rnoh/react-native-openharmony/src/main/cpp")
set(RNOH_GENERATED_DIR "${CMAKE_CURRENT_SOURCE_DIR}/generated")
set(OH_MODULES_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../../../oh_modules")
set(LOG_VERBOSITY_LEVEL 1)
set(CMAKE_ASM_FLAGS "-Wno-error=unused-command-line-argument -Qunused-arguments")
set(CMAKE_CXX_FLAGS "-fstack-protector-strong -Wl,-z,relro,-z,now,-z,noexecstack -s -fPIE -pie")
set(CMAKE_SKIP_RPATH TRUE)
get_filename_component(ORCA_SOURCE_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../../../../.." ABSOLUTE)
add_compile_options(
  "-ffile-prefix-map=${ORCA_SOURCE_ROOT}=."
  "-fdebug-prefix-map=${ORCA_SOURCE_ROOT}=."
)
set(WITH_HITRACE_SYSTRACE ON)
set(WITH_HITRACE_REACT_MARKER ON)

add_subdirectory("${RNOH_CPP_DIR}" ./rn)
include("${CMAKE_CURRENT_SOURCE_DIR}/LegacyRNOHCompatibility.cmake")
add_subdirectory("${OH_MODULES_DIR}/@react-native-oh-tpl/async-storage/src/main/cpp" ./async-storage)
add_subdirectory("${OH_MODULES_DIR}/@react-native-oh-tpl/react-native-gesture-handler/src/main/cpp" ./gesture-handler)
add_subdirectory("${OH_MODULES_DIR}/@react-native-oh-tpl/react-native-reanimated/src/main/cpp" ./reanimated)
add_subdirectory("${OH_MODULES_DIR}/@react-native-oh-tpl/react-native-safe-area-context/src/main/cpp" ./safe-area)
add_subdirectory("${OH_MODULES_DIR}/@react-native-oh-tpl/react-native-svg/src/main/cpp" ./svg)
add_subdirectory("${OH_MODULES_DIR}/@react-native-oh-tpl/react-native-webview/src/main/cpp" ./webview)
target_include_directories(
  rnoh_gesture_handler
  BEFORE
  PRIVATE
  "${CMAKE_CURRENT_SOURCE_DIR}/compat"
)
target_compile_options(
  rnoh_reanimated
  PRIVATE
  -UREACT_NATIVE_MINOR_VERSION
  -DREACT_NATIVE_MINOR_VERSION=84
  -UHERMES_ENABLE_DEBUGGER
  -DHERMES_ENABLE_DEBUGGER=0
)
target_compile_options(
  rnoh_safe_area
  PRIVATE
  -include
  "${CMAKE_CURRENT_SOURCE_DIR}/ReactNativeCompatibility.h"
)
target_compile_options(
  rnoh_svg
  PRIVATE
  -include
  "${CMAKE_CURRENT_SOURCE_DIR}/ReactNativeCompatibility.h"
)

file(GLOB GENERATED_CPP_FILES CONFIGURE_DEPENDS "${RNOH_GENERATED_DIR}/*.cpp")
add_library(rnoh_app SHARED
  ${GENERATED_CPP_FILES}
  "./PackageProvider.cpp"
  "${RNOH_CPP_DIR}/RNOHAppNapiBridge.cpp"
)

target_link_libraries(
  rnoh_app
  PUBLIC
  rnoh
  rnoh_async_storage
  rnoh_gesture_handler
  rnoh_reanimated
  rnoh_safe_area
  rnoh_svg
  rnoh_webview
)
