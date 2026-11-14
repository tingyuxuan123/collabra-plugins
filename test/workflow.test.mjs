import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { repoRoot } from './helpers.mjs';

const publish = readFileSync(join(repoRoot, '.github/workflows/publish.yml'), 'utf8');
const validate = readFileSync(join(repoRoot, '.github/workflows/validate.yml'), 'utf8');

test('PR 校验只读、无 secret、无 pull_request_target', () => {
  assert.match(validate, /on:\n  pull_request:/);
  assert.match(validate, /permissions:\n  contents: read/);
  assert.doesNotMatch(validate, /secrets\./);
  assert.doesNotMatch(validate, /pull_request_target/);
  assert.doesNotMatch(validate, /npm install/);
});

test('生产签名私钥只在 sign 步骤出现一次', () => {
  const occurrences = publish.match(/^\s+COLLABRA_MARKET_PRIVATE_KEY:/gm) ?? [];
  assert.equal(occurrences.length, 1);
  const signAt = publish.indexOf('  sign:');
  const secretAt = publish.indexOf('COLLABRA_MARKET_PRIVATE_KEY');
  const publishAt = publish.indexOf('  publish:');
  assert.ok(signAt >= 0 && publishAt > signAt);
  assert.ok(secretAt > signAt && secretAt < publishAt);
  assert.doesNotMatch(publish, /--allow-test-key/);
  assert.doesNotMatch(publish, /pull_request_target/);
});

test('发布任务具备 Pages 与 dist 所需最小权限并串行', () => {
  assert.match(publish, /concurrency:\n  group: collabra-market-publish\n  cancel-in-progress: false/);
  assert.match(publish, /pages: write/);
  assert.match(publish, /id-token: write/);
  assert.match(publish, /contents: write/);
  assert.match(publish, /actions\/configure-pages@v5/);
  assert.match(publish, /actions\/upload-pages-artifact@v3/);
  assert.match(publish, /actions\/deploy-pages@v4/);
  assert.match(publish, /scripts\/ci\/publish-dist\.sh/);
  assert.match(publish, /node scripts\/verify-build\.mjs --out build --signed/);
  assert.match(publish, /Rebuild from reviewed source and compare/);
  assert.match(publish, /--out rebuild --now "\$generated_at"/);
});
