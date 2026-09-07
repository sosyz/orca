import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import vm from 'node:vm'
import { afterEach, describe, expect, it } from 'vitest'
import {
  displayHostEndpoint,
  endpointPort,
  endpointScheme,
  normalizeHostEndpoint
} from '../transport/host-endpoint'

type CjsModule = { exports: Record<string, unknown> }
type CjsRequire = (id: string) => unknown
type BabelTransform = (typeof import('@babel/core'))['transformSync']
type Esbuild = typeof import('esbuild')
type UrlConstructor = typeof URL
type UrlSearchParamsConstructor = typeof URLSearchParams

const mobileRoot = resolve(import.meta.dirname, '../..')
const harmonyRoot = join(mobileRoot, 'harmony')
const requireFromHarmony = createRequire(join(harmonyRoot, 'package.json'))
const originalUrl = globalThis.URL
const originalUrlSearchParams = globalThis.URLSearchParams
const originalMarker = (globalThis as { REACT_NATIVE_URL_POLYFILL?: string })
  .REACT_NATIVE_URL_POLYFILL

const reactNativeMock = {
  NativeModules: {
    BlobModule: {
      getConstants: () => ({
        BLOB_URI_HOST: 'orca',
        BLOB_URI_SCHEME: 'blob'
      })
    }
  },
  Platform: { OS: 'harmony', Version: '12' }
}

function runCommonJs(source: string, filename: string, requireImpl: CjsRequire): CjsModule {
  const module: CjsModule = { exports: {} }
  const compiled = vm.runInThisContext(`(function(require,module,exports){\n${source}\n})`, {
    filename
  }) as (require: CjsRequire, module: CjsModule, exports: Record<string, unknown>) => void
  compiled(requireImpl, module, module.exports)
  return module
}

function babelPlugin(name: string): unknown {
  return requireFromHarmony(name)
}

function transformWithBabel(filename: string, plugins: unknown[]): string {
  const transformSync = requireFromHarmony('@babel/core').transformSync as BabelTransform
  const result = transformSync(readFileSync(filename, 'utf8'), {
    babelrc: false,
    configFile: false,
    filename,
    plugins
  })
  if (!result?.code) {
    throw new Error(`Babel produced no code for ${filename}`)
  }
  return result.code
}

function loadRnohUrlImplementation(): {
  URL: UrlConstructor
  URLSearchParams: UrlSearchParamsConstructor
} {
  const flow = babelPlugin('@babel/plugin-transform-flow-strip-types')
  const commonJs = babelPlugin('@babel/plugin-transform-modules-commonjs')
  const urlSearchParamsModule = runCommonJs(
    transformWithBabel(
      join(
        harmonyRoot,
        'node_modules/@react-native-oh/react-native-harmony/Libraries/Blob/URLSearchParams.js'
      ),
      [flow, commonJs]
    ),
    'rnoh-url-search-params.js',
    requireFromHarmony
  )
  const urlModule = runCommonJs(
    transformWithBabel(
      join(harmonyRoot, 'node_modules/@react-native-oh/react-native-harmony/Libraries/Blob/URL.js'),
      [flow, commonJs]
    ),
    'rnoh-url.js',
    (id) => {
      if (id === './URLSearchParams') {
        return urlSearchParamsModule.exports
      }
      if (id === './NativeBlobModule') {
        return {
          __esModule: true,
          default: reactNativeMock.NativeModules.BlobModule
        }
      }
      return requireFromHarmony(id)
    }
  )
  return urlModule.exports as {
    URL: UrlConstructor
    URLSearchParams: UrlSearchParamsConstructor
  }
}

function runOfficialAutoPolyfill(): void {
  const esbuild = requireFromHarmony('esbuild') as Esbuild
  const result = esbuild.buildSync({
    bundle: true,
    entryPoints: [join(harmonyRoot, 'node_modules/react-native-url-polyfill/auto.js')],
    external: ['react-native'],
    format: 'cjs',
    logLevel: 'silent',
    platform: 'node',
    write: false
  })
  const source = result.outputFiles[0]?.text
  if (!source) {
    throw new Error('esbuild produced no URL polyfill bundle')
  }
  runCommonJs(source, 'react-native-url-polyfill-auto.js', (id) => {
    if (id === 'react-native') {
      return reactNativeMock
    }
    return requireFromHarmony(id)
  })
}

function installGlobalUrl(
  URLImpl: UrlConstructor,
  URLSearchParamsImpl: UrlSearchParamsConstructor
) {
  Object.defineProperty(globalThis, 'URL', {
    configurable: true,
    value: URLImpl,
    writable: true
  })
  Object.defineProperty(globalThis, 'URLSearchParams', {
    configurable: true,
    value: URLSearchParamsImpl,
    writable: true
  })
}

describe('Harmony URL polyfill bootstrap', () => {
  afterEach(() => {
    installGlobalUrl(originalUrl, originalUrlSearchParams)
    if (originalMarker === undefined) {
      delete (globalThis as { REACT_NATIVE_URL_POLYFILL?: string }).REACT_NATIVE_URL_POLYFILL
    } else {
      ;(globalThis as { REACT_NATIVE_URL_POLYFILL?: string }).REACT_NATIVE_URL_POLYFILL =
        originalMarker
    }
  })

  it('runs the official polyfill after the RNOH URL subset and before app imports', () => {
    const { URL: RnohURL, URLSearchParams: RnohURLSearchParams } = loadRnohUrlImplementation()
    installGlobalUrl(RnohURL, RnohURLSearchParams)

    expect(new URL('ws://desktop.local:6768').hostname).toBe('')
    expect(new URLSearchParams('raw=a=b').get('raw')).toBe('a')
    expect(() => {
      const relay = new URL('https://relay-c1.onorca.dev')
      relay.protocol = 'wss:'
    }).toThrow(TypeError)

    runOfficialAutoPolyfill()

    const direct = new URL('ws://desktop.local:6768')
    expect(direct.hostname).toBe('desktop.local')
    expect(direct.host).toBe('desktop.local:6768')
    expect(direct.port).toBe('6768')

    const secure = new URL('wss://relay-c1.onorca.dev/v1')
    expect(secure.hostname).toBe('relay-c1.onorca.dev')
    expect(secure.pathname).toBe('/v1')

    const ipv6 = new URL('ws://[2001:db8::1]:6768')
    expect(ipv6.hostname).toBe('[2001:db8::1]')
    expect(ipv6.host).toBe('[2001:db8::1]:6768')

    const relative = new URL('../next?raw=a%3Db', 'wss://relay-c1.onorca.dev/base/path')
    expect(relative.toString()).toBe('wss://relay-c1.onorca.dev/next?raw=a%3Db')
    expect(relative.searchParams.get('raw')).toBe('a=b')

    const relay = new URL('https://relay-c1.onorca.dev')
    relay.protocol = 'wss:'
    relay.pathname = '/v1/connect/AbCdEf0123_-xyZ9'
    expect(relay.toString()).toBe('wss://relay-c1.onorca.dev/v1/connect/AbCdEf0123_-xyZ9')

    expect(new URLSearchParams('raw=a=b').get('raw')).toBe('a=b')
    expect(URL.createObjectURL({ data: { blobId: 'blob-1', offset: 2 }, size: 3 } as Blob)).toBe(
      'blob://orca/blob-1?offset=2&size=3'
    )
    expect(normalizeHostEndpoint('ws://desktop.local:6768')).toEqual({
      endpoint: 'ws://desktop.local:6768',
      ok: true
    })
    expect(displayHostEndpoint('wss://relay-c1.onorca.dev/v1/connect/id')).toBe(
      'relay-c1.onorca.dev'
    )
    expect(endpointPort('ws://desktop.local:6768')).toBe('6768')
    expect(endpointScheme('wss://relay-c1.onorca.dev/v1/connect/id')).toBe('wss')

    const indexSource = readFileSync(join(harmonyRoot, 'index.js'), 'utf8')
    const autoImportIndex = indexSource.indexOf("import 'react-native-url-polyfill/auto'")
    const appImportIndex = indexSource.indexOf("import { HarmonyApp } from './src/HarmonyApp'")
    expect(autoImportIndex).toBeGreaterThanOrEqual(0)
    expect(appImportIndex).toBeGreaterThanOrEqual(0)
    expect(autoImportIndex).toBeLessThan(appImportIndex)
  })
})
