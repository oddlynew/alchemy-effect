export const raw = true;

export default function dataLoader(source) {
  const bytes = Buffer.isBuffer(source) ? source : Buffer.from(source);
  return `export default new Uint8Array([${Array.from(bytes).join(",")}]).buffer;`;
}
