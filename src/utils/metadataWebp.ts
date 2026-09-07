import crypto from "node:crypto";
import webp from "node-webpmux";
export async function addStickerMetadata(
  buffer: Buffer,
  pack: string,
  author: string,
): Promise<Buffer> {
  const image = new webp.Image();
  const metadata = {
    "sticker-pack-id": crypto.randomBytes(32).toString("hex"),
    "sticker-pack-name": pack,
    "sticker-pack-publisher": author,
  };

  const exifHeader = Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
  ]);

  const json = Buffer.from(JSON.stringify(metadata), "utf8");

  const exif = Buffer.concat([exifHeader, json]);

  exif.writeUIntLE(json.length, 14, 4);

  await image.load(buffer);

  image.exif = exif;

  return await image.save(null);
}
