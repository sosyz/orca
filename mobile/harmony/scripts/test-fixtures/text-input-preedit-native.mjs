import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const textInputSourcePaths = [
  'RNOH/arkui/TextInputNode.cpp',
  'RNOH/arkui/TextAreaNode.cpp',
  'RNOHCorePackage/ComponentInstances/TextInputComponentInstance.cpp',
  'patches/react_native_core/react/renderer/components/textinput/TextInputEventEmitter.h',
  'patches/react_native_core/react/renderer/components/textinput/TextInputEventEmitter.cpp',
  'third-party/rn/ReactCommon/react/renderer/components/textinput/TextInputEventEmitter.h'
].map((path) => `src/main/cpp/${path}`)

function declaration(source, signature) {
  const start = source.indexOf(signature)
  if (start === -1 || source.includes(signature, start + signature.length)) {
    throw new Error(`Expected one native declaration: ${signature}`)
  }
  let position = source.indexOf('{', start)
  let depth = 1
  while (depth > 0 && ++position < source.length) {
    if (source[position] === '{') {
      depth++
    }
    if (source[position] === '}') {
      depth--
    }
  }
  if (depth !== 0) {
    throw new Error(`Unterminated native declaration: ${signature}`)
  }
  return source.slice(start, position + 1)
}

export function runNativeTextInputCase(packageRoot, scenario, multiline = false) {
  const sources = textInputSourcePaths.map((path) => readFileSync(join(packageRoot, path), 'utf8'))
  const component = sources[2]
  let fixture = readFileSync(new URL('./text-input-preedit.cpp', import.meta.url), 'utf8')
  const replacements = {
    METRICS: declaration(sources[3], 'struct Metrics') + ';',
    PAYLOAD: declaration(sources[4], 'static jsi::Value textInputMetricsPayload('),
    EMITTER_CHANGE: declaration(sources[4], 'void TextInputEventEmitter::onChange('),
    EMITTER_DISPATCH: declaration(
      sources[4],
      'void TextInputEventEmitter::dispatchTextInputEvent('
    ),
    INPUT_CHANGE: declaration(sources[0], 'void TextInputNode::onChange('),
    AREA_CHANGE: declaration(sources[1], 'void TextAreaNode::onChange('),
    COMPONENT_CHANGE: declaration(component, 'void TextInputComponentInstance::onChange('),
    COMPONENT_METRICS: declaration(
      component,
      'facebook::react::TextInputEventEmitter::Metrics\nTextInputComponentInstance::getTextInputMetrics('
    ),
    COMPONENT_COMMAND: declaration(
      component,
      'void TextInputComponentInstance::onCommandReceived('
    ),
    COMMITTED_KEY: declaration(component, 'void TextInputComponentInstance::emitCommittedKeyPress(')
  }
  const steps = scenario.steps.map((step) => {
    if ('command' in step) {
      // onStateChanged clears this even when its content equals the native text.
      return `input.m_extendStr.clear();
        input.onCommandReceived("setTextAndSelection", {"",0,{{"",input.m_nativeEventCount,{}},{${JSON.stringify(step.command)},0,{}},{"",${step.selection[0]},{}},{"",${step.selection[1]},{}}}});
        commandSelections.emplace_back(input.m_selectionLocation,input.m_selectionLength);`
    }
    return `node.nativeText = ${JSON.stringify(step.text)};
      node.onChange(${JSON.stringify(step.text)},${JSON.stringify(step.preview)});`
  })
  replacements.CASE = `previewSupported = ${scenario.previewSupported};
    TextInputComponentInstance input;
    input.m_multiline = ${multiline};
    auto& node = input.${multiline ? 'm_textAreaNode' : 'm_textInputNode'};
    ${steps.join('\n')}`
  for (const [name, body] of Object.entries(replacements)) {
    fixture = fixture.replace(`/* ${name} */`, body)
  }
  const directory = mkdtempSync(join(tmpdir(), 'orca-text-input-native-'))
  try {
    const source = join(directory, 'preedit.cpp')
    const binary = join(directory, process.platform === 'win32' ? 'preedit.exe' : 'preedit')
    writeFileSync(source, fixture)
    execFileSync(process.env.CXX || 'clang++', ['-std=c++17', source, '-o', binary], {
      encoding: 'utf8',
      stdio: 'pipe'
    })
    const output = execFileSync(binary, [], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
    return {
      events: output.filter((entry) => !entry.commandSelection),
      commandSelections: output
        .filter((entry) => entry.commandSelection)
        .map((entry) => entry.commandSelection)
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
