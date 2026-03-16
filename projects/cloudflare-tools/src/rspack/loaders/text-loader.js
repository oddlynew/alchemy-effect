export const raw = true;

export default function textLoader(source) {
  const content = Buffer.isBuffer(source) ? source.toString("utf8") : String(source);
  return `export default ${JSON.stringify(content)};`;
}
