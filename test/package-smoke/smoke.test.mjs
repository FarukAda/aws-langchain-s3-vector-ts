import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('packaged tarball exposes the public API', () => {
  execSync('npm run build', { stdio: 'inherit' });
  const tarball = execSync('npm pack --silent').toString().trim();
  const dir = mkdtempSync(join(tmpdir(), 's3v-smoke-'));

  execSync('npm init -y', { cwd: dir, stdio: 'ignore' });
  execSync(`npm install "${join(process.cwd(), tarball)}"`, { cwd: dir, stdio: 'inherit' });

  execSync(
    'node --input-type=module -e "' +
      "import('@farukada/aws-langchain-s3-vector-ts').then((m)=>{" +
      "if(typeof m.AmazonS3Vectors!=='function')process.exit(2);" +
      "if(typeof m.S3VectorsError!=='function')process.exit(3);" +
      "if(typeof m.isS3VectorsError!=='function')process.exit(4);" +
      "if(m.S3VectorsErrorCode.VALIDATION!=='VALIDATION')process.exit(5);" +
      '})"',
    { cwd: dir, stdio: 'inherit' },
  );

  assert.ok(true);
});