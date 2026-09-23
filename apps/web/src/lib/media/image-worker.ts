interface ImageWorkerRequest {
  readonly file: Blob;
  readonly maxEdge: number;
  readonly targetBytes: number;
  readonly maxBytes: number;
}

interface ImageWorkerResponse {
  readonly ok: boolean;
  readonly blob?: Blob;
  readonly error?: string;
}

async function encode(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  quality: number,
): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("IMAGE_PROCESSING_UNAVAILABLE");
  context.drawImage(bitmap, 0, 0, width, height);
  return canvas.convertToBlob({ type: "image/webp", quality });
}

self.onmessage = (event: MessageEvent<ImageWorkerRequest>) => {
  void (async () => {
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(event.data.file);
      const scale = Math.min(1, event.data.maxEdge / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      let output = await encode(bitmap, width, height, 0.86);
      if (output.size > event.data.targetBytes) {
        output = await encode(bitmap, width, height, 0.72);
      }
      if (output.size > event.data.maxBytes) {
        throw new Error("MEDIA_POLICY_VIOLATION");
      }
      (self as unknown as { postMessage(message: ImageWorkerResponse): void }).postMessage({
        ok: true,
        blob: output,
      });
    } catch (caught) {
      (self as unknown as { postMessage(message: ImageWorkerResponse): void }).postMessage({
        ok: false,
        error: caught instanceof Error ? caught.message : "IMAGE_PROCESSING_FAILED",
      });
    } finally {
      bitmap?.close();
    }
  })();
};
