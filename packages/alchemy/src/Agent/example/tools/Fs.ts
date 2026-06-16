import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as S from "effect/Schema";

import * as Cloudflare from "../../../Cloudflare/index.ts";
import * as Ai from "../../index.ts";
import { DevBox } from "../DevBox.ts";

export const path = Ai.Parameter("path", S.String)`
The path to the file to search.`;

export const contents = Ai.Parameter("contents", S.String)`
The contents of the file to write.`;

export class WriteFile extends Ai.Tool<WriteFile>()("writeFile")`
Create or overwrite a file at the given ${path} with the provided ${contents}.` {}

export const WriteFileDevBox = Layer.effect(
  WriteFile,
  Effect.gen(function* () {
    const devBox = yield* Cloudflare.Container.running(DevBox);

    return ({ path, contents }) => devBox.writeFile(path, contents);
  }),
);

export class ReadFile extends Ai.Tool("readFile")`
Read the contents of a file at the given ${path}.` {}

export class EditFile extends Ai.Tool("editFile")`
Apply a targeted edit to an existing file by replacing an exact string with a new one.` {}
