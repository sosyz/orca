import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const emitterDirectory = 'react/renderer/components/textinput/'
const headerChanges = [
  ['#pragma once\n', '#pragma once\n\n#include <optional>\n'],
  [
    '    std::string text;\n    AttributedString::Range',
    '    std::string text;\n    std::optional<bool> isComposing;\n    AttributedString::Range'
  ]
]

const sourcePatches = [
  {
    path: `patches/react_native_core/${emitterDirectory}TextInputEventEmitter.h`,
    sha256: 'b3e9fc9bf8a953bae10826a28a5edf4f6a2246e8c752417d1c1c8a0c4c347cd1',
    changes: headerChanges
  },
  {
    // Different native targets search these two include roots in different orders.
    path: `third-party/rn/ReactCommon/${emitterDirectory}TextInputEventEmitter.h`,
    sha256: '7b2f94239b5ec4457e8cd676e34fff3392077eebf5b4f363d1329b4d74de4944',
    changes: headerChanges
  },
  {
    path: `patches/react_native_core/${emitterDirectory}TextInputEventEmitter.cpp`,
    sha256: 'a0ce79273c075c54674a712cd191a965c0ddcf1405e0c31d944d54a4e49a2213',
    changes: [
      [
        '  payload.setProperty(runtime, "eventCount", textInputMetrics.eventCount);',
        `  payload.setProperty(runtime, "eventCount", textInputMetrics.eventCount);

  if (textInputMetrics.isComposing.has_value()) {
    payload.setProperty(runtime, "isComposing", *textInputMetrics.isComposing);
  }`
      ]
    ]
  },
  {
    path: 'RNOHCorePackage/ComponentInstances/TextInputComponentInstance.cpp',
    sha256: '311276f3e35789dff8d373ba85fa5dbc1c8b2a75be55632b00854fd5c266c008',
    changes: [
      [
        '#include "TextInputComponentInstance.h"',
        '#include "TextInputComponentInstance.h"\n#include "RNOH/arkui/DynamicArkUILoader.h"'
      ],
      [
        '  textInputMetrics.eventCount = this->m_nativeEventCount;',
        `  if (DynamicArkUILoader::getTextChangeEventFun()) {
    textInputMetrics.isComposing = m_inPreviewMode;
  }
  textInputMetrics.eventCount = this->m_nativeEventCount;`
      ],
      [
        '    if (m_extendStr.empty()) {\n      setTextContent(textContent);',
        `    // A redundant native write can swallow the next same-text IME commit as its echo.
    if (m_extendStr.empty() && textContent != m_content) {
      setTextContent(textContent);`
      ]
    ]
  }
]

export function patchReactNativeCoreTextInput(packageRoot) {
  for (const patch of sourcePatches) {
    const sourcePath = join(packageRoot, 'src/main/cpp', patch.path)
    let source = readFileSync(sourcePath, 'utf8')
    if (createHash('sha256').update(source).digest('hex') !== patch.sha256) {
      throw new Error(`Unsupported RNOH 0.84.3 TextInput source: ${patch.path}`)
    }
    for (const [before, after] of patch.changes) {
      if (source.split(before).length !== 2) {
        throw new Error(`Expected one TextInput patch anchor in ${patch.path}`)
      }
      source = source.replace(before, after)
    }
    writeFileSync(sourcePath, source)
  }
}
