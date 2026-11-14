import assert from 'node:assert/strict';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { verifyBytes } from '../scripts/lib/crypto.mjs';
import { buildMarket, signMarket } from '../scripts/lib/market.mjs';
import { readZipEntries } from '../scripts/lib/zip.mjs';
import {
  addPaperVersion,
  copyPaperSource,
  fixedNow,
  makeKeys,
  paperMarketPath,
  paperVersionDir,
  readJson,
  tempDir,
  testBuild,
  testSign,
  writeJson,
} from './helpers.mjs';

function setup() {
  const root = tempDir();
  const sources = copyPaperSource(root);
  const keys = makeKeys(join(root, 'keys'));
  return { root, sources, keys };
}

function readIndex(out) {
  return readJson(join(out, 'v1', 'index.json'));
}

test('首次构建生成 v2 索引、确定性 ZIP、版本 README 与站点', () => {
  const { root, sources, keys } = setup();
  const out = join(root, 'out');
  const result = testBuild({
    sources,
    history: join(root, 'no-history'),
    out,
    keys,
    includeWeb: true,
  });
  assert.equal(result.index.schemaVersion, 2);
  assert.equal(result.index.marketId, 'collabra');
  assert.equal(result.index.sequence, 1);
  assert.equal(result.index.generatedAt, fixedNow);
  assert.equal(result.index.plugins.length, 1);
  const plugin = result.index.plugins[0];
  assert.equal(plugin.id, 'collabra.paper');
  assert.equal(plugin.tier, 'official');
  assert.equal(plugin.category, 'themes');
  assert.equal(plugin.license, 'MIT');
  assert.equal(plugin.versions.length, 1);
  assert.deepEqual(plugin.versions[0].compatibility, {
    host: 'collabra',
    apiVersion: 1,
    minAppVersion: '0.2.80',
    platforms: ['darwin', 'win32', 'linux'],
    testedSurfaces: [],
  });
  assert.deepEqual(plugin.versions[0].permissions, []);
  assert.equal(plugin.versions[0].path, 'packages/collabra.paper/1.0.0.zip');
  assert.equal(plugin.readme.path, 'readmes/collabra.paper/1.0.0.md');
  assert.equal(existsSync(join(out, 'v1', plugin.readme.path)), true);
  assert.equal(existsSync(join(out, 'v1', 'index.json.sig')), false);
  assert.equal(existsSync(join(out, 'index.html')), true);
  assert.equal(existsSync(join(out, 'site.css')), true);
  assert.equal(existsSync(join(out, 'catalog.js')), true);
  const entries = readZipEntries(
    readFileSync(join(out, 'v1', plugin.versions[0].path))
  );
  const paths = entries.map((entry) => entry.path);
  assert.ok(paths.includes('enso-plugin.json'));
  assert.ok(paths.includes('README.md'));
  assert.ok(paths.includes('LICENSE'));
  assert.ok(paths.includes('themes/paper.json'));
  assert.equal(paths.some((path) => path.startsWith('.')), false);
});

test('相同输入得到逐字节相同的包与索引', () => {
  const { root, sources, keys } = setup();
  const first = join(root, 'first');
  const second = join(root, 'second');
  const base = { sources, history: join(root, 'none'), keys, now: fixedNow };
  testBuild({ ...base, out: first });
  testBuild({ ...base, out: second });
  const packagePath = join('v1', 'packages', 'collabra.paper', '1.0.0.zip');
  assert.deepEqual(readFileSync(join(first, packagePath)), readFileSync(join(second, packagePath)));
  assert.deepEqual(
    readFileSync(join(first, 'v1', 'index.json')),
    readFileSync(join(second, 'v1', 'index.json'))
  );
});

test('签名覆盖精确索引字节且能验证', () => {
  const { root, sources, keys } = setup();
  const out = join(root, 'out');
  testBuild({ sources, history: join(root, 'none'), out, keys });
  const result = testSign({ out, history: join(root, 'none'), keys });
  assert.equal(result.sequence, 1);
  const bytes = readFileSync(join(out, 'v1', 'index.json'));
  const signature = readFileSync(join(out, 'v1', 'index.json.sig'), 'utf8').trim();
  assert.equal(verifyBytes(bytes, signature, keys.publicPem), true);
  const tampered = Buffer.from(bytes);
  tampered[0] ^= 1;
  assert.equal(verifyBytes(tampered, signature, keys.publicPem), false);
});

test('历史版本字节与兼容性不可变，新版本必须递增并保留旧包', async (t) => {
  const { root, sources, keys } = setup();
  const first = join(root, 'first');
  testBuild({ sources, history: join(root, 'none'), out: first, keys });
  testSign({ out: first, history: join(root, 'none'), keys });
  const oldPackage = readFileSync(
    join(first, 'v1', 'packages', 'collabra.paper', '1.0.0.zip')
  );

  await t.test('同版本改动文件被拒绝', () => {
    const cloned = copyPaperSource(join(tempDir(), 'clone'));
    writeFileSync(
      join(paperVersionDir(cloned, '1.0.0'), 'themes', 'paper.json'),
      readFileSync(
        join(paperVersionDir(cloned, '1.0.0'), 'themes', 'paper.json'),
        'utf8'
      ).replace('#f7f5f0', '#f7f5f1')
    );
    assert.throws(
      () =>
        testBuild({
          sources: cloned,
          history: first,
          out: join(root, 'bad-out'),
          keys,
        }),
      /字节不变|内容被修改/
    );
  });

  await t.test('同版本 compatibility 改动被拒绝', () => {
    const cloned = copyPaperSource(join(tempDir(), 'clone'));
    const market = readJson(paperMarketPath(cloned));
    market.versions['1.0.0'].compatibility.minAppVersion = '0.3.0';
    writeJson(paperMarketPath(cloned), market);
    assert.throws(
      () =>
        testBuild({
          sources: cloned,
          history: first,
          out: join(root, 'bad-out'),
          keys,
        }),
      /compatibility/
    );
  });

  await t.test('新版本递增且旧 ZIP 不重写', () => {
    const cloned = copyPaperSource(join(tempDir(), 'clone'));
    addPaperVersion(cloned, '1.0.1', { readme: '# Paper 1.0.1\n' });
    const second = join(root, 'second');
    const result = testBuild({ sources: cloned, history: first, out: second, keys });
    assert.equal(result.index.sequence, 2);
    const versions = result.index.plugins[0].versions.map((version) => version.version);
    assert.deepEqual(versions, ['1.0.0', '1.0.1']);
    assert.equal(
      result.index.plugins[0].readme.path,
      'readmes/collabra.paper/1.0.1.md'
    );
    assert.deepEqual(
      readFileSync(join(second, 'v1', 'packages', 'collabra.paper', '1.0.0.zip')),
      oldPackage
    );
    assert.equal(
      existsSync(join(second, 'v1', 'readmes', 'collabra.paper', '1.0.0.md')),
      true
    );
    assert.equal(
      existsSync(join(second, 'v1', 'readmes', 'collabra.paper', '1.0.1.md')),
      true
    );
    const signed = testSign({ out: second, history: first, keys });
    assert.equal(signed.sequence, 2);
  });

  await t.test('低于历史版本的“新”版本被拒绝', () => {
    const cloned = copyPaperSource(join(tempDir(), 'clone'));
    addPaperVersion(cloned, '0.9.0');
    assert.throws(
      () =>
        testBuild({
          sources: cloned,
          history: first,
          out: join(root, 'lower-out'),
          keys,
        }),
      /不是高于历史最新版本/
    );
  });
});

test('历史包、索引或 README 被篡改时构建失败', async (t) => {
  const { root, sources, keys } = setup();
  const first = join(root, 'first');
  testBuild({ sources, history: join(root, 'none'), out: first, keys });
  testSign({ out: first, history: join(root, 'none'), keys });

  await t.test('包内容篡改', () => {
    const clonedHistory = join(tempDir(), 'history');
    cpSync(first, clonedHistory, { recursive: true });
    const path = join(clonedHistory, 'v1', 'packages', 'collabra.paper', '1.0.0.zip');
    const bytes = readFileSync(path);
    bytes[bytes.length - 1] ^= 0xff;
    writeFileSync(path, bytes);
    assert.throws(
      () =>
        testBuild({
          sources,
          history: clonedHistory,
          out: join(root, 'tampered-out'),
          keys,
        }),
      /哈希不匹配/
    );
  });

  await t.test('索引字节篡改', () => {
    const clonedHistory = join(tempDir(), 'history');
    cpSync(first, clonedHistory, { recursive: true });
    const path = join(clonedHistory, 'v1', 'index.json');
    const text = readFileSync(path, 'utf8');
    writeFileSync(path, text.replace('"sequence": 1', '"sequence": 2'));
    assert.throws(
      () =>
        testBuild({
          sources,
          history: clonedHistory,
          out: join(root, 'tampered-out2'),
          keys,
        }),
      /签名无效/
    );
  });

  await t.test('README 篡改', () => {
    const clonedHistory = join(tempDir(), 'history');
    cpSync(first, clonedHistory, { recursive: true });
    writeFileSync(
      join(clonedHistory, 'v1', 'readmes', 'collabra.paper', '1.0.0.md'),
      '# changed\n'
    );
    assert.throws(
      () =>
        testBuild({
          sources,
          history: clonedHistory,
          out: join(root, 'tampered-out3'),
          keys,
        }),
      /README (?:大小|哈希)不匹配/
    );
  });
});

test('签名步骤再次拒绝历史字段篡改，不能靠重新签名洗白', () => {
  const { root, sources, keys } = setup();
  const first = join(root, 'first');
  testBuild({ sources, history: join(root, 'none'), out: first, keys });
  testSign({ out: first, history: join(root, 'none'), keys });
  const next = join(root, 'next');
  testBuild({ sources, history: first, out: next, keys });
  const indexPath = join(next, 'v1', 'index.json');
  const index = readJson(indexPath);
  index.plugins[0].versions[0].compatibility.minAppVersion = '0.3.0';
  writeJson(indexPath, index);
  assert.throws(
    () => testSign({ out: next, history: first, keys }),
    /历史版本字段被篡改/
  );
});

test('sequence 必须严格等于历史 +1，回滚或跳号拒绝签名', () => {
  const { root, sources, keys } = setup();
  const first = join(root, 'first');
  testBuild({ sources, history: join(root, 'none'), out: first, keys });
  testSign({ out: first, history: join(root, 'none'), keys });
  const next = join(root, 'next');
  testBuild({ sources, history: first, out: next, keys });
  const indexPath = join(next, 'v1', 'index.json');
  const index = readJson(indexPath);
  index.sequence = 9;
  writeJson(indexPath, index);
  assert.throws(() => testSign({ out: next, history: first, keys }), /sequence/);
});

test('delisted 停止索引但保留历史 ZIP 与 README', () => {
  const { root, sources, keys } = setup();
  const first = join(root, 'first');
  testBuild({ sources, history: join(root, 'none'), out: first, keys });
  testSign({ out: first, history: join(root, 'none'), keys });
  const market = readJson(paperMarketPath(sources));
  market.delisted = true;
  writeJson(paperMarketPath(sources), market);
  const next = join(root, 'next');
  const result = testBuild({ sources, history: first, out: next, keys });
  assert.deepEqual(result.index.plugins, []);
  assert.equal(
    existsSync(join(next, 'v1', 'packages', 'collabra.paper', '1.0.0.zip')),
    true
  );
  assert.equal(
    existsSync(join(next, 'v1', 'readmes', 'collabra.paper', '1.0.0.md')),
    true
  );
  assert.equal(testSign({ out: next, history: first, keys }).sequence, 2);
});

test('源目录移除插件时保留历史索引，避免意外删除', () => {
  const { root, sources, keys } = setup();
  const first = join(root, 'first');
  testBuild({ sources, history: join(root, 'none'), out: first, keys });
  testSign({ out: first, history: join(root, 'none'), keys });
  const emptySources = join(root, 'empty-plugins');
  mkdirSync(emptySources, { recursive: true });
  const next = join(root, 'next');
  const result = testBuild({ sources: emptySources, history: first, out: next, keys });
  assert.deepEqual(
    result.index.plugins.map((plugin) => plugin.id),
    ['collabra.paper']
  );
});

test('delisted 后重新上架新版本时，旧 ZIP 仍可留在 dist 而不阻塞签名', () => {
  const { root, sources, keys } = setup();
  const first = join(root, 'first');
  testBuild({ sources, history: join(root, 'none'), out: first, keys });
  testSign({ out: first, history: join(root, 'none'), keys });
  const market = readJson(paperMarketPath(sources));
  market.delisted = true;
  writeJson(paperMarketPath(sources), market);
  const delisted = join(root, 'delisted');
  testBuild({ sources, history: first, out: delisted, keys });
  testSign({ out: delisted, history: first, keys });

  const relisted = copyPaperSource(join(tempDir(), 'relisted'));
  addPaperVersion(relisted, '2.0.0');
  const relistedMarket = readJson(paperMarketPath(relisted));
  delete relistedMarket.versions['1.0.0'];
  delete relistedMarket.delisted;
  writeJson(paperMarketPath(relisted), relistedMarket);
  rmSync(paperVersionDir(relisted, '1.0.0'), { recursive: true, force: true });
  const next = join(root, 'next');
  const result = testBuild({ sources: relisted, history: delisted, out: next, keys });
  assert.deepEqual(
    result.index.plugins[0].versions.map((version) => version.version),
    ['2.0.0']
  );
  assert.equal(
    existsSync(join(next, 'v1', 'packages', 'collabra.paper', '1.0.0.zip')),
    true
  );
  assert.equal(testSign({ out: next, history: delisted, keys }).sequence, 3);
});

test('测试密钥不能走生产默认路径', () => {
  const { root, sources, keys } = setup();
  assert.throws(
    () =>
      buildMarket({
        sourcesDir: sources,
        historyDir: join(root, 'none'),
        outDir: join(root, 'out'),
        webDir: join(root, 'web'),
        now: fixedNow,
        publicKeyPem: keys.publicPem,
        allowTestKey: false,
        includeWeb: false,
      }),
    /非生产公钥/
  );
  assert.throws(
    () =>
      signMarket({
        outDir: join(root, 'out'),
        historyDir: join(root, 'none'),
        privateKeyPem: keys.privatePem,
        publicKeyPem: keys.publicPem,
        allowTestKey: false,
      }),
    /非生产公钥/
  );
});

test('站点目录不能覆盖 v1 产物', () => {
  const { root, sources, keys } = setup();
  const web = join(root, 'web');
  mkdirSync(join(web, 'v1'), { recursive: true });
  writeFileSync(join(web, 'index.html'), 'x');
  writeFileSync(join(web, 'site.css'), 'x');
  writeFileSync(join(web, 'catalog.js'), 'x');
  assert.throws(
    () =>
      buildMarket({
        sourcesDir: sources,
        historyDir: join(root, 'none'),
        outDir: join(root, 'out'),
        webDir: web,
        now: fixedNow,
        publicKeyPem: keys.publicPem,
        allowTestKey: true,
        includeWeb: true,
      }),
    /保留路径/
  );
});

test('输出目录不能覆盖插件源或历史目录', () => {
  const { root, sources, keys } = setup();
  assert.throws(
    () =>
      testBuild({
        sources,
        history: join(root, 'none'),
        out: sources,
        keys,
      }),
    /重叠/
  );
  assert.equal(existsSync(join(sources, 'collabra.paper', 'market.json')), true);
});
