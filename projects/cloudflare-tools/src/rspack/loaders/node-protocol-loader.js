export default function nodeProtocolLoader(source) {
  const content = typeof source === "string" ? source : source.toString("utf8");
  const alias = this.getOptions?.().alias ?? {};
  const rewrite = (specifier) =>
    alias[specifier] ??
    alias[`node:${specifier}`] ??
    alias[specifier.replace(/^node:/, "")] ??
    specifier;

  return content
    .replaceAll(/from\s+["']([^"'`]+)["']/g, (_match, specifier) => `from ${JSON.stringify(rewrite(specifier))}`)
    .replaceAll(/import\s*\(\s*["']([^"'`]+)["']\s*\)/g, (_match, specifier) => `import(${JSON.stringify(rewrite(specifier))})`)
    .replaceAll(/require\s*\(\s*["']([^"'`]+)["']\s*\)/g, (_match, specifier) => `require(${JSON.stringify(rewrite(specifier))})`);
}
