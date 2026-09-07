import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

function collectRuntimeSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      return collectRuntimeSources(path)
    }
    if (!/\.tsx?$/.test(entry.name)) {
      return []
    }
    if (/\.(?:test|generated)\./.test(entry.name) || entry.name.includes('test-harness')) {
      return []
    }
    return [path]
  })
}

function collectModuleSpecifiers(path: string): string[] {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    false,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  const modules: string[] = []
  function visit(node: ts.Node): void {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      modules.push(node.moduleSpecifier.text)
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      modules.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return modules
}

function packageName(moduleName: string): string {
  return moduleName.startsWith('@')
    ? moduleName.split('/').slice(0, 2).join('/')
    : moduleName.split('/')[0]
}

describe('Harmony runtime dependency contract', () => {
  it('keeps HarmonyOS 5 compatibility while targeting API 21', () => {
    const mobileRoot = resolve(import.meta.dirname, '../..')
    const profile = readFileSync(join(mobileRoot, 'harmony/build-profile.template.json5'), 'utf8')

    expect(profile).toContain('"targetSdkVersion": "6.0.1(21)"')
    expect(profile).toContain('"compatibleSdkVersion": "5.0.0(12)"')
  })

  it('preserves the RNOH resolver after applying compatibility aliases', () => {
    const mobileRoot = resolve(import.meta.dirname, '../..')
    const config = readFileSync(join(mobileRoot, 'harmony/metro.config.js'), 'utf8')

    expect(config).toContain('const harmonyConfig = createHarmonyMetroConfig')
    expect(config).toContain('const resolveHarmonyRequest = harmonyConfig.resolver.resolveRequest')
    expect(config).toContain('return resolveHarmonyRequest(context, moduleName, platform)')
  })

  it('provides safe-area context above the shared root layout', () => {
    const mobileRoot = resolve(import.meta.dirname, '../..')
    const app = readFileSync(join(mobileRoot, 'harmony/src/HarmonyApp.tsx'), 'utf8')

    expect(app).toContain("import { SafeAreaProvider } from 'react-native-safe-area-context'")
    expect(app.indexOf('<SafeAreaProvider>')).toBeLessThan(app.indexOf('<RootLayout />'))
  })

  it('keeps the UI-only Orca native module off the RNOH worker', () => {
    const mobileRoot = resolve(import.meta.dirname, '../..')
    const packageSource = readFileSync(
      join(mobileRoot, 'harmony/entry/src/main/ets/native/OrcaHarmonyPackage.ets'),
      'utf8'
    )
    const abilitySource = readFileSync(
      join(mobileRoot, 'harmony/entry/src/main/ets/entryability/EntryAbility.ets'),
      'utf8'
    )

    expect(packageSource).toContain('getUITurboModuleFactoryByNameMap')
    expect(abilitySource).not.toContain('getRNOHWorkerScriptUrl')
  })

  it('code-generates and compiles the Orca native bridge', () => {
    const mobileRoot = resolve(import.meta.dirname, '../..')
    const harmonyPackage = JSON.parse(
      readFileSync(join(mobileRoot, 'harmony/package.json'), 'utf8')
    ) as { harmony?: { codegenConfig?: { specPaths?: string[] } } }
    const spec = readFileSync(join(mobileRoot, 'harmony/src/native/NativeOrcaHarmony.ts'), 'utf8')
    const cmake = readFileSync(
      join(mobileRoot, 'harmony/entry/src/main/cpp/CMakeLists.txt'),
      'utf8'
    )

    expect(harmonyPackage.harmony?.codegenConfig?.specPaths).toContain(
      './src/native/NativeOrcaHarmony.ts'
    )
    expect(spec).toContain("TurboModuleRegistry.get<Spec>('OrcaHarmony')")
    expect(cmake).toContain('file(GLOB GENERATED_CPP_FILES CONFIGURE_DEPENDS')
  })

  it('maps every Expo native API and declares every shared runtime package', () => {
    const mobileRoot = resolve(import.meta.dirname, '../..')
    const modules = new Set(
      [join(mobileRoot, 'app'), join(mobileRoot, 'src')]
        .flatMap(collectRuntimeSources)
        .flatMap(collectModuleSpecifiers)
        .filter((moduleName) => !moduleName.startsWith('.') && !moduleName.startsWith('@/'))
    )
    const aliases = readFileSync(join(mobileRoot, 'harmony/metro.config.js'), 'utf8')
    const harmonyPackage = JSON.parse(
      readFileSync(join(mobileRoot, 'harmony/package.json'), 'utf8')
    ) as { dependencies: Record<string, string> }

    const compatibilityModules = [...modules].filter(
      (moduleName) => moduleName.startsWith('expo-') || moduleName === '@orca/expo-two-way-audio'
    )
    for (const moduleName of compatibilityModules) {
      expect(aliases, `${moduleName} needs a Harmony compatibility adapter`).toContain(
        `'${moduleName}':`
      )
    }

    const nativePackages = [...modules]
      .map(packageName)
      .filter(
        (name) =>
          name.startsWith('react-native-') || name === '@react-native-async-storage/async-storage'
      )
    for (const name of nativePackages) {
      expect(harmonyPackage.dependencies, `${name} needs a Harmony dependency`).toHaveProperty(name)
    }
  })

  it('reports generated WebView engine packages as production dependencies', () => {
    const mobileRoot = resolve(import.meta.dirname, '../..')
    const harmonyPackage = JSON.parse(
      readFileSync(join(mobileRoot, 'harmony/package.json'), 'utf8')
    ) as {
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
    }

    for (const name of [
      '@xterm/addon-unicode11',
      '@xterm/addon-webgl',
      '@xterm/xterm',
      'mermaid'
    ]) {
      expect(
        harmonyPackage.dependencies,
        `${name} must be included in the release SBOM`
      ).toHaveProperty(name)
      expect(harmonyPackage.devDependencies).not.toHaveProperty(name)
    }
  })
})
