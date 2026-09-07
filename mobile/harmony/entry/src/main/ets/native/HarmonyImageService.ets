import { util } from '@kit.ArkTS';
import { fileIo } from '@kit.CoreFileKit';
import { image } from '@kit.ImageKit';
import { pasteboard } from '@kit.BasicServicesKit';
import { HarmonyFileService } from './HarmonyFileService';

interface ImageSize {
  height: number;
  width: number;
}

const HARMONY_IMAGE_MAX_PIXELS = 32 * 1024 * 1024;
// Keep this in sync with CLIPBOARD_IMAGE_MAX_BASE64_CHARS in shared clipboard limits.
const HARMONY_IMAGE_MAX_BYTES = Math.floor((24 * 1024 * 1024 / 4) * 3);

export interface HarmonyClipboardImage {
  data: string;
  size: ImageSize;
}

export interface HarmonyManipulatedImage {
  base64: string;
  height: number;
  uri: string;
  width: number;
}

export class HarmonyImageService {
  private readonly base64 = new util.Base64Helper();
  private readonly files: HarmonyFileService;
  private manipulatedImageSequence = 0;

  constructor(files: HarmonyFileService) {
    this.files = files;
  }

  async clipboardImage(): Promise<HarmonyClipboardImage | null> {
    const systemPasteboard = pasteboard.getSystemPasteboard();
    if (!(await systemPasteboard.hasData())) {
      return null;
    }
    const data = await systemPasteboard.getData();
    if (data.getPrimaryMimeType() !== pasteboard.MIMETYPE_PIXELMAP) {
      return null;
    }
    const pixelMap = data.getPrimaryPixelMap();
    try {
      const info = await pixelMap.getImageInfo();
      this.assertImageSize(info.size.width, info.size.height);
      const packed = await this.packPng(pixelMap);
      const size: ImageSize = { height: info.size.height, width: info.size.width };
      return {
        data: `data:image/png;base64,${this.base64.encodeToStringSync(new Uint8Array(packed))}`,
        size: size,
      };
    } finally {
      try {
        await pixelMap.release();
      } catch (_) {
      }
    }
  }

  async manipulate(uri: string, width: number, height: number): Promise<HarmonyManipulatedImage> {
    const file = fileIo.openSync(this.files.resolveUri(uri), fileIo.OpenMode.READ_ONLY);
    let source: image.ImageSource | undefined = undefined;
    let pixelMap: image.PixelMap | undefined = undefined;
    try {
      source = image.createImageSource(file.fd);
      const original = await source.getImageInfo();
      this.assertImageSize(original.size.width, original.size.height);
      const targetWidth = width > 0 ? width : original.size.width;
      const targetHeight = height > 0 ? height : original.size.height;
      this.assertImageSize(targetWidth, targetHeight);
      const desiredSize: image.Size = { width: targetWidth, height: targetHeight };
      const options: image.DecodingOptions = { desiredSize: desiredSize };
      pixelMap = await source.createPixelMap(options);
      const rendered = await pixelMap.getImageInfo();
      this.assertImageSize(rendered.size.width, rendered.size.height);
      const packed = await this.packPng(pixelMap);
      const encoded = this.base64.encodeToStringSync(new Uint8Array(packed));
      const path = this.files.cachePath(
        `orca-image-${Date.now()}-${this.manipulatedImageSequence++}.png`,
      );
      const resultUri = this.files.fileUri(path);
      this.files.writeBytes(resultUri, packed);
      return {
        base64: encoded,
        height: rendered.size.height,
        uri: resultUri,
        width: rendered.size.width,
      };
    } finally {
      await this.releaseImageResources(pixelMap, source, file);
    }
  }

  private async releaseImageResources(
    pixelMap: image.PixelMap | undefined,
    source: image.ImageSource | undefined,
    file: fileIo.File,
  ): Promise<void> {
    try {
      if (pixelMap) {
        await pixelMap.release();
      }
    } catch (_) {
    }
    try {
      if (source) {
        await source.release();
      }
    } catch (_) {
    }
    try {
      fileIo.closeSync(file);
    } catch (_) {
    }
  }

  private async packPng(pixelMap: image.PixelMap): Promise<ArrayBuffer> {
    const packer = image.createImagePacker();
    const options: image.PackingOption = { format: 'image/png', quality: 100 };
    try {
      // API 12 compatibility: packToData starts at API 13.
      const packed = await packer.packing(pixelMap, options);
      if (packed.byteLength > HARMONY_IMAGE_MAX_BYTES) {
        throw new Error('Image data exceeds the Harmony limit');
      }
      return packed;
    } finally {
      try {
        await packer.release();
      } catch (_) {
      }
    }
  }

  private assertImageSize(width: number, height: number): void {
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      Math.floor(width) !== width ||
      Math.floor(height) !== height ||
      width <= 0 ||
      height <= 0 ||
      width > HARMONY_IMAGE_MAX_PIXELS ||
      height > HARMONY_IMAGE_MAX_PIXELS ||
      width > Math.floor(HARMONY_IMAGE_MAX_PIXELS / height)
    ) {
      throw new Error('Image dimensions exceed the Harmony limit');
    }
  }
}
