import { HarmonyNative } from '../native/harmony-native-module'

export const Paths = { cache: 'file://orca-cache' }

function joinUri(base: string, name?: string): string {
  if (!name) {
    return base
  }
  return `${base.replace(/\/$/, '')}/${name}`
}

export class File {
  readonly uri: string

  constructor(base: string, name?: string) {
    this.uri = joinUri(base, name)
  }

  get size(): number {
    return HarmonyNative.fileSize(this.uri)
  }

  create(_options?: { overwrite?: boolean }): void {
    this.write('')
  }

  delete(): void {
    HarmonyNative.deleteFile(this.uri)
  }

  open() {
    let offset = 0
    const size = this.size
    return {
      close: () => undefined,
      readBytes: (length: number) => {
        const bytes = Uint8Array.from(HarmonyNative.readFileBytes(this.uri, offset, length))
        offset += bytes.byteLength
        return bytes
      },
      size
    }
  }

  write(data: string, options?: { encoding?: string }): void {
    HarmonyNative.writeFile(this.uri, data, options?.encoding ?? 'utf8')
  }
}
