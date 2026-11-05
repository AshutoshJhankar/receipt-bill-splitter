/**
 * Shrink a phone photo before upload: max 1600px on the long side, JPEG ~85%.
 * A 4 MB camera photo usually becomes ~250 KB, which is faster to upload and cheaper for the vision model.
 */
export async function compressImage(file, maxSide = 1600, quality = 0.85) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Couldn't open that image. Please use a JPG or PNG photo (HEIC isn't supported in this browser).");
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't process the image."))), "image/jpeg", quality),
  );
}
