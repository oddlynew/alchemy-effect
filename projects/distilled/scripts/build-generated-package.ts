import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript5";

const packageRoot = resolve(process.argv[2] ?? ".");
const sourceRoot = join(packageRoot, "src");
const outputRoot = join(packageRoot, "lib");
const declarationsOnly = process.argv.includes("--declarations-only");

const compilerOptions: ts.CompilerOptions = {
  allowImportingTsExtensions: true,
  declaration: true,
  declarationMap: true,
  esModuleInterop: true,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  noCheck: true,
  noResolve: true,
  outDir: outputRoot,
  rewriteRelativeImportExtensions: true,
  rootDir: sourceRoot,
  skipLibCheck: true,
  sourceMap: true,
  strict: true,
  target: ts.ScriptTarget.ESNext,
  verbatimModuleSyntax: true,
};

const listTypeScriptFiles = (directory: string): Array<string> =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return listTypeScriptFiles(path);
    }

    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });

const toOutputPath = (sourceFile: string, extension: string) => {
  const sourceRelativePath = relative(sourceRoot, sourceFile);
  return join(outputRoot, sourceRelativePath.replace(/\.ts$/, extension));
};

const writeJavaScript = (sourceFile: string) => {
  const source = readFileSync(sourceFile, "utf8");
  const outputFile = toOutputPath(sourceFile, ".js");
  const outputMapFile = `${outputFile}.map`;
  const result = ts.transpileModule(source, {
    compilerOptions,
    fileName: sourceFile,
  });

  mkdirSync(dirname(outputFile), { recursive: true });

  const sourceMap = result.sourceMapText
    ? JSON.stringify(
        {
          ...JSON.parse(result.sourceMapText),
          file: basename(outputFile),
          sources: [
            relative(dirname(outputFile), sourceFile).split(sep).join("/"),
          ],
        },
        null,
        2,
      )
    : undefined;

  const outputText = result.outputText.replace(
    /\/\/# sourceMappingURL=.*$/m,
    `//# sourceMappingURL=${basename(outputMapFile)}`,
  );

  writeFileSync(outputFile, outputText);

  if (sourceMap) {
    writeFileSync(outputMapFile, `${sourceMap}\n`);
  }
};

const writeDeclarations = (sourceFile: string) => {
  const host = ts.createCompilerHost({
    ...compilerOptions,
    emitDeclarationOnly: true,
    sourceMap: false,
  });
  const program = ts.createProgram([sourceFile], compilerOptions, host);
  const result = program.emit(undefined, undefined, undefined, true);

  if (result.emitSkipped) {
    const message = result.diagnostics
      .map((diagnostic) =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      )
      .join("\n");

    throw new Error(message || `Failed to emit declarations for ${sourceFile}`);
  }
};

if (!declarationsOnly) {
  rmSync(outputRoot, { force: true, recursive: true });
}

for (const sourceFile of listTypeScriptFiles(sourceRoot).sort()) {
  if (!declarationsOnly) {
    writeJavaScript(sourceFile);
  }

  writeDeclarations(sourceFile);
}
