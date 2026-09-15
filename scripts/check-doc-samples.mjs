/**
 * Type-check every TypeScript sample in the shipped documentation.
 *
 * `documented-api.test.ts` already checks that the docs name only methods,
 * codes and exports that exist. A name is not a signature: `delete` stayed a
 * real method when its parameters changed, so every README snippet calling it
 * the old way still passed that gate. This compiles the samples instead —
 * against `src/`, not against a copy — so a documented call that no longer
 * type-checks fails the build.
 *
 * Free identifiers a snippet assumes (`store`, `embeddings`, …) are supplied
 * as ambient globals. A snippet that declares its own shadows them, so the
 * samples stay readable: none of them has to be padded with setup to compile.
 *
 * Genuinely illustrative blocks — pseudo-code, or integrations with packages
 * this one does not depend on — are skipped by marking them in the document:
 *
 *     <!-- sample:skip why this block cannot compile -->
 *
 * The reason is required, and the total number of skips is asserted below, so
 * silencing a real breakage costs an edit that shows up in review.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = join(root, '.doc-samples');

/** The documents whose samples a reader is expected to be able to run. */
const DOCUMENTS = ['README.md', 'src/guide.md', 'CHANGELOG.md'];

/** Blocks legitimately un-compilable, and why. Growing this list is the point. */
const EXPECTED_SKIPS = 1;

/** A sample is worth compiling only if there are samples; guards an empty scan. */
const MINIMUM_SAMPLES = 30;

const FENCE = /(?:<!--\s*sample:skip\s+([^>]*?)\s*-->\s*\n)?```(?:ts|typescript)\n([\s\S]*?)```/g;

const GLOBALS = `import type { Document as CoreDocument } from '@langchain/core/documents';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';
import type { AmazonS3Vectors as Store } from '@farukada/aws-langchain-s3-vector-ts';

declare global {
  // The context a snippet assumes rather than repeats. Each has the type the
  // real thing has, so a call in the documentation is checked as strictly as
  // a call in the source: only the setup is elided, never the checking.
  const embeddings: EmbeddingsInterface;
  const documentEmbeddings: EmbeddingsInterface;
  const queryEmbeddings: EmbeddingsInterface;
  const querySpecificEmbeddings: EmbeddingsInterface;
  const store: Store;
  const target: Store;
  const config: import('@farukada/aws-langchain-s3-vector-ts').AmazonS3VectorsConfig;
  const docs: CoreDocument[];
  const documents: CoreDocument[];
  const largeDocs: CoreDocument[];
  const manyDocuments: CoreDocument[];
  const controller: AbortController;
  const signal: AbortSignal;
  const myCredentialProvider: NonNullable<
    import('@aws-sdk/client-s3vectors').S3VectorsClientConfig['credentials']
  >;
  // An embeddings package the reader brings; this one depends on none.
  const BedrockEmbeddings: new (...args: never[]) => EmbeddingsInterface;
  // Real exports a snippet uses without repeating the import: resolved from
  // the package, so a rename breaks this check rather than the reader.
  const isS3VectorsError: typeof import('@farukada/aws-langchain-s3-vector-ts').isS3VectorsError;
  const AmazonS3Vectors: typeof import('@farukada/aws-langchain-s3-vector-ts').AmazonS3Vectors;
  const Document: typeof import('@langchain/core/documents').Document;
  type Document<
    Metadata extends Record<string, unknown> = Record<string, unknown>,
  > = CoreDocument<Metadata>;
}

export {};
`;

const TSCONFIG = {
  extends: '../tsconfig.json',
  compilerOptions: {
    noEmit: true,
    outDir: null,
    rootDir: null,
    declaration: false,
    sourceMap: false,
    inlineSources: false,
    // A snippet shows the call, not what the reader does with its result.
    noUnusedLocals: false,
    noUnusedParameters: false,
    paths: { '@farukada/aws-langchain-s3-vector-ts': ['../src/index.ts'] },
  },
  include: ['*.ts', '*.d.ts'],
};

function collect() {
  const samples = [];
  let skipped = 0;
  for (const doc of DOCUMENTS) {
    const text = readFileSync(join(root, doc), 'utf8');
    let index = 0;
    for (const match of text.matchAll(FENCE)) {
      const [, reason, block] = match;
      const position = index++;
      if (reason !== undefined) {
        if (reason.trim().length < 15) {
          console.error(`${doc} sample #${position}: sample:skip needs a reason, got "${reason}"`);
          process.exitCode = 1;
        }
        skipped++;
        continue;
      }
      samples.push({ doc, position, block });
    }
  }
  return { samples, skipped };
}

function write(samples) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'globals.d.ts'), GLOBALS);
  writeFileSync(join(outDir, 'tsconfig.json'), `${JSON.stringify(TSCONFIG, null, 2)}\n`);
  for (const { doc, position, block } of samples) {
    const name = `${doc.replace(/\W/g, '_')}_${position}.ts`;
    // `export {}` makes the snippet a module: without it a snippet that
    // imports nothing is a script, where top-level `await` is an error the
    // reader would never hit.
    writeFileSync(join(outDir, name), `${block}\nexport {};\n`);
  }
}

const { samples, skipped } = collect();

if (samples.length < MINIMUM_SAMPLES) {
  console.error(
    `Only ${samples.length} samples found (expected at least ${MINIMUM_SAMPLES}). ` +
      'A scan that finds nothing must not pass.',
  );
  process.exit(1);
}

if (skipped !== EXPECTED_SKIPS) {
  console.error(
    `${skipped} samples are marked sample:skip, but ${EXPECTED_SKIPS} are expected. ` +
      'Skipping a sample is a deliberate change: update EXPECTED_SKIPS in this script.',
  );
  process.exit(1);
}

write(samples);

// The compiler is run through Node directly rather than through `npx`: a
// `.cmd` shim needs a shell on Windows, and this must behave the same on
// every platform CI runs on.
const compiler = fileURLToPath(new URL('../node_modules/typescript/bin/tsc6', import.meta.url));
const result = spawnSync(
  process.execPath,
  [compiler, '--noEmit', '-p', join(outDir, 'tsconfig.json')],
  { cwd: root, encoding: 'utf8' },
);

if (result.error) {
  console.error(`Could not run the compiler: ${result.error.message}`);
  process.exit(1);
}

const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();

if (result.status !== 0) {
  console.error(output);
  console.error(
    `\n${samples.length} documentation samples checked; the failures above are in the ` +
      'documents, not in the generated files — each file is named for the document and the ' +
      'position of the block inside it.',
  );
  process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });
console.log(`${samples.length} documentation samples type-check (${skipped} skipped).`);
