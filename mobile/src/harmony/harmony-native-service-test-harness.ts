import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { transformSync } from 'esbuild'

export function loadHarmonyNativeService<T>(fileName: string, imports: Record<string, unknown>): T {
  const sourcePath = resolve(
    import.meta.dirname,
    '../../harmony/entry/src/main/ets/native',
    fileName
  )
  const { code } = transformSync(readFileSync(sourcePath, 'utf8'), {
    loader: 'ts',
    format: 'cjs',
    sourcefile: sourcePath
  })
  const module = { exports: {} }
  runInNewContext(
    code,
    {
      module,
      exports: module.exports,
      ArrayBuffer,
      clearTimeout,
      setTimeout,
      Uint8Array,
      require(name: string) {
        if (!Object.hasOwn(imports, name)) {
          throw new Error(`Missing native service mock: ${name}`)
        }
        return imports[name]
      }
    },
    { filename: sourcePath }
  )
  return module.exports as T
}
