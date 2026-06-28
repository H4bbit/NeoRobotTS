declare module "node-webpmux" {
  export class Image {
    exif?: Buffer;

    load(source: Buffer | string): Promise<void>;
    save(destination: string | null): Promise<Buffer>;
  }

  const webp: {
    Image: typeof Image;
  };

  export default webp;
}
