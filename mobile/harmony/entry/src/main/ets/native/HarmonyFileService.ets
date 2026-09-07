import { buffer, util } from '@kit.ArkTS';
import { fileIo, picker } from '@kit.CoreFileKit';
import { photoAccessHelper } from '@kit.MediaLibraryKit';
import type { common } from '@kit.AbilityKit';

const CACHE_URI_PREFIX = 'file://orca-cache';
const MULTI_SELECT_LIMIT = 50;
export const HARMONY_FILE_MAX_BYTES = 32 * 1024 * 1024;

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer
    : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

export interface HarmonyPickedFile {
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  uri: string;
}

export class HarmonyFileService {
  private readonly base64 = new util.Base64Helper();
  private readonly context: common.UIAbilityContext;
  private pickedFileSequence = 0;

  constructor(context: common.UIAbilityContext) {
    this.context = context;
  }

  delete(uri: string): void {
    try {
      fileIo.unlinkSync(this.resolveUri(uri, 'delete'));
    } catch (_) {
    }
  }

  size(uri: string): number {
    try {
      const file = fileIo.openSync(this.resolveUri(uri), fileIo.OpenMode.READ_ONLY);
      try {
        return fileIo.statSync(file.fd).size;
      } finally {
        fileIo.closeSync(file);
      }
    } catch (_) {
      return 0;
    }
  }

  read(uri: string, offset: number, length: number): number[] {
    this.assertReadRange(offset, length);
    const file = fileIo.openSync(
      this.resolveUri(uri, 'read'),
      fileIo.OpenMode.READ_ONLY,
    );
    try {
      const data = new ArrayBuffer(length);
      const bytesRead = fileIo.readSync(file.fd, data, {
        offset: offset,
        length: length,
      });
      return Array.from(new Uint8Array(data, 0, bytesRead));
    } finally {
      fileIo.closeSync(file);
    }
  }

  write(uri: string, data: string, encoding: string): void {
    if (typeof data !== 'string') {
      throw new Error('File data exceeds the Harmony limit');
    }
    let bytes: Uint8Array;
    if (encoding === 'base64') {
      if (data.length > Math.ceil((HARMONY_FILE_MAX_BYTES / 3) * 4) + 4) {
        throw new Error('File data exceeds the Harmony limit');
      }
      bytes = this.base64.decodeSync(data);
    } else {
      if (data.length > HARMONY_FILE_MAX_BYTES) {
        throw new Error('File data exceeds the Harmony limit');
      }
      const encoded = buffer.from(data, 'utf-8');
      bytes = new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.length);
    }
    this.writeBytes(uri, exactBuffer(bytes));
  }

  writeBytes(uri: string, data: ArrayBuffer): void {
    const path = this.resolveUri(uri, 'write');
    this.assertByteLength(data.byteLength);
    const file = fileIo.openSync(
      path,
      fileIo.OpenMode.CREATE | fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.TRUNC,
    );
    try {
      if (fileIo.writeSync(file.fd, data) !== data.byteLength) {
        throw new Error('Incomplete cache file write');
      }
    } catch (error) {
      this.delete(uri);
      throw error as Error;
    } finally {
      fileIo.closeSync(file);
    }
  }

  async pick(kind: string, multiple: boolean): Promise<HarmonyPickedFile[]> {
    const uris = kind === 'image'
      ? await this.pickImages(multiple)
      : await this.pickDocuments(multiple);
    const picked: HarmonyPickedFile[] = [];
    try {
      for (const uri of uris) {
        picked.push(await this.copyPickedFileToCache(uri));
      }
      return picked;
    } catch (copyError) {
      picked.forEach((file) => this.delete(file.uri));
      throw copyError as Error;
    }
  }

  cachePath(name: string): string {
    return `${this.context.cacheDir}/${name}`;
  }

  fileUri(path: string): string {
    return `file://${path}`;
  }

  resolveUri(uri: string, operation: 'read' | 'write' | 'delete' = 'read'): string {
    if (uri === CACHE_URI_PREFIX) {
      if (operation !== 'read') {
        throw new Error('File writes and deletes require a cache file');
      }
      return this.context.cacheDir;
    }
    if (uri.startsWith(`${CACHE_URI_PREFIX}/`)) {
      const name = uri.slice(CACHE_URI_PREFIX.length + 1);
      if (!this.isSafeCacheName(name)) {
        throw new Error('Unsupported cache URI');
      }
      return `${this.context.cacheDir}/${name}`;
    }
    if (uri.startsWith('file:///')) {
      const path = uri.slice('file://'.length);
      if (path === this.context.cacheDir) {
        if (operation !== 'read') {
          throw new Error('File writes and deletes require a cache file');
        }
        return path;
      }
      if (path.startsWith(`${this.context.cacheDir}/`)) {
        const name = path.slice(this.context.cacheDir.length + 1);
        if (this.isSafeCacheName(name)) {
          return path;
        }
        throw new Error('Unsupported cache URI');
      }
    }
    if (operation !== 'read') {
      throw new Error('File writes and deletes are restricted to the app cache');
    }
    if (uri.startsWith('content://')) {
      return uri;
    }
    if (uri.startsWith('file:///') && !this.hasPathTraversal(uri)) {
      return uri.slice('file://'.length);
    }
    throw new Error('Unsupported file URI');
  }

  private assertReadRange(offset: number, length: number): void {
    if (
      !Number.isFinite(offset) ||
      !Number.isFinite(length) ||
      Math.floor(offset) !== offset ||
      Math.floor(length) !== length ||
      offset < 0 ||
      length < 0 ||
      length > HARMONY_FILE_MAX_BYTES ||
      offset > HARMONY_FILE_MAX_BYTES - length
    ) {
      throw new Error('File read range exceeds the Harmony limit');
    }
  }

  private assertByteLength(length: number): void {
    if (!Number.isFinite(length) || length < 0 || length > HARMONY_FILE_MAX_BYTES) {
      throw new Error('File data exceeds the Harmony limit');
    }
  }

  private isSafeCacheName(name: string): boolean {
    return (
      name.length > 0 &&
      name.length <= 256 &&
      !name.includes('/') &&
      !name.includes('\\') &&
      !name.includes('\0') &&
      name !== '.' &&
      name !== '..'
    );
  }

  private hasPathTraversal(uri: string): boolean {
    return uri.split('/').some((segment) => segment === '.' || segment === '..');
  }

  private async pickImages(multiple: boolean): Promise<string[]> {
    const options = new photoAccessHelper.PhotoSelectOptions();
    options.MIMEType = photoAccessHelper.PhotoViewMIMETypes.IMAGE_TYPE;
    options.maxSelectNumber = multiple ? MULTI_SELECT_LIMIT : 1;
    const result = await new photoAccessHelper.PhotoViewPicker().select(options);
    return result.photoUris;
  }

  private async pickDocuments(multiple: boolean): Promise<string[]> {
    const options = new picker.DocumentSelectOptions();
    options.fileSuffixFilters = ['Images|.png,.jpg,.jpeg,.gif,.webp,.bmp,.heic,.heif'];
    options.maxSelectNumber = multiple ? MULTI_SELECT_LIMIT : 1;
    return new picker.DocumentViewPicker(this.context).select(options);
  }

  private describe(uri: string): HarmonyPickedFile {
    const result: HarmonyPickedFile = { uri: uri };
    result.fileName = this.fileName(uri);
    result.fileSize = this.size(uri);
    result.mimeType = this.mimeType(result.fileName);
    return result;
  }

  private async copyPickedFileToCache(uri: string): Promise<HarmonyPickedFile> {
    const name = this.safePickedFileName(uri);
    const path = this.cachePath(
      `orca-picked-${Date.now()}-${this.pickedFileSequence++}-${name}`,
    );
    const source = fileIo.openSync(uri, fileIo.OpenMode.READ_ONLY);
    try {
      this.assertByteLength(fileIo.statSync(source.fd).size);
      await fileIo.copyFile(source.fd, path);
      this.assertByteLength(fileIo.statSync(path).size);
      return this.describe(this.fileUri(path));
    } catch (copyError) {
      try {
        fileIo.unlinkSync(path);
      } catch (_) {
      }
      throw copyError as Error;
    } finally {
      fileIo.closeSync(source);
    }
  }

  private safePickedFileName(uri: string): string {
    const name = this.fileName(uri)
      .replace(/[\\/]/gu, '_')
      .replaceAll('\0', '_')
      .slice(-128);
    return name && name !== '.' && name !== '..' ? name : 'image';
  }

  private fileName(uri: string): string {
    const withoutQuery = uri.split('?')[0];
    const segments = withoutQuery.split('/');
    const encoded = segments[segments.length - 1] || 'image';
    try {
      return decodeURIComponent(encoded);
    } catch (_) {
      return encoded;
    }
  }

  private mimeType(name: string): string {
    const extension = name.toLowerCase().split('.').pop();
    if (extension === 'png') {
      return 'image/png';
    }
    if (extension === 'gif') {
      return 'image/gif';
    }
    if (extension === 'webp') {
      return 'image/webp';
    }
    if (extension === 'bmp') {
      return 'image/bmp';
    }
    if (extension === 'heic' || extension === 'heif') {
      return 'image/heic';
    }
    return 'image/jpeg';
  }
}
