import assert from 'node:assert/strict';
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  historyLedgerPath,
  historyLedgerSignaturePath,
  historySnapshotPath,
  historySnapshotSignaturePath,
} from '../scripts/lib/constants.mjs';
import {
  addPaperVersion,
  copyPaperSource,
  makeKeys,
  paperMarketPath,
  readJson,
  tempDir,
  testBuild,
  testSign,
  writeJson,
} from './helpers.mjs';

function setup() {
  const root = tempDir('collabra-history-test-');
  const sources = copyPaperSource(root);
  const keys = makeKeys(join(root, 'keys'));
  return { root, sources, keys };
}

function firstGeneration() {
  const { root, sources, keys } = setup();
  const first = join(root, 'first');
  testBuild({ sources, history: join(root, 'none'), out: first, keys });
  testSign({ out: first, history: join(root, 'none'), keys });
  return { root, sources, keys, first };
}

test('签名代生成 index snapshot 与 signed artifact ledger', () => {
  const { first } = firstGeneration();
  for (const relative of [
    historySnapshotPath(1),
    historySnapshotSignaturePath(1),
    historyLedgerPath(1),
    historyLedgerSignaturePath(1),
  ]) {
    assert.equal(existsSync(join(first, 'v1', relative)), true, relative);
  }
  const snapshot = readFileSync(join(first, 'v1', historySnapshotPath(1)));
  assert.deepEqual(snapshot, readFileSync(join(first, 'v1', 'index.json')));
  const ledger = readJson(join(first, 'v1', historyLedgerPath(1)));
  assert.equal(ledger.schemaVersion, 1);
  assert.equal(ledger.sequence, 1);
  assert.equal(ledger.artifacts.length, 1);
  assert.equal(ledger.artifacts[0].pluginId, 'collabra.paper');
  assert.equal(ledger.artifacts[0].version, '1.0.0');
  assert.match(ledger.artifacts[0].readme.sha256, /^[0-9a-f]{64}$/);
});

test('删除或篡改历史 snapshot/ledger 阻止下一轮构建', async (t) => {
  const { root, sources, keys, first } = firstGeneration();
  const cases = [
    ['删除 snapshot', (dir) => rmSync(join(dir, 'v1', historySnapshotPath(1)))],
    ['删除 snapshot 签名', (dir) => rmSync(join(dir, 'v1', historySnapshotSignaturePath(1)))],
    ['删除 ledger', (dir) => rmSync(join(dir, 'v1', historyLedgerPath(1)))],
    ['删除 ledger 签名', (dir) => rmSync(join(dir, 'v1', historyLedgerSignaturePath(1)))],
    [
      '篡改 snapshot',
      (dir) => {
        const path = join(dir, 'v1', historySnapshotPath(1));
        writeFileSync(path, readFileSync(path, 'utf8').replace('"sequence": 1', '"sequence": 2'));
      },
    ],
    [
      '篡改 ledger',
      (dir) => {
        const path = join(dir, 'v1', historyLedgerPath(1));
        writeFileSync(path, readFileSync(path, 'utf8').replace('"sequence": 1', '"sequence": 2'));
      },
    ],
  ];
  for (const [label, mutate] of cases) {
    await t.test(label, () => {
      const history = join(tempDir(), 'history');
      cpSync(first, history, { recursive: true });
      mutate(history);
      assert.throws(() =>
        testBuild({
          sources,
          history,
          out: join(root, `out-${label}`),
          keys,
        })
      );
    });
  }
});

test('delist 后篡改旧 ZIP 或旧 README 仍被 signed ledger 拒绝', async (t) => {
  const { root, sources, keys, first } = firstGeneration();
  const market = readJson(paperMarketPath(sources));
  market.delisted = true;
  writeJson(paperMarketPath(sources), market);
  const delisted = join(root, 'delisted');
  testBuild({ sources, history: first, out: delisted, keys });
  testSign({ out: delisted, history: first, keys });

  await t.test('篡改 delisted ZIP', () => {
    const history = join(tempDir(), 'history');
    cpSync(delisted, history, { recursive: true });
    const path = join(history, 'v1', 'packages', 'collabra.paper', '1.0.0.zip');
    const bytes = readFileSync(path);
    bytes[bytes.length - 1] ^= 0xff;
    writeFileSync(path, bytes);
    assert.throws(
      () => testBuild({ sources, history, out: join(root, 'tampered-zip'), keys }),
      /ledger|哈希|包/
    );
  });

  await t.test('篡改 delisted 旧 README', () => {
    const history = join(tempDir(), 'history');
    cpSync(delisted, history, { recursive: true });
    writeFileSync(
      join(history, 'v1', 'readmes', 'collabra.paper', '1.0.0.md'),
      '# tampered\n'
    );
    assert.throws(
      () => testBuild({ sources, history, out: join(root, 'tampered-readme'), keys }),
      /ledger|哈希|README/
    );
  });
});

test('relist 同版本不能修改 compatibility，也不能低于 ledger 最新版本', async (t) => {
  const { root, sources, keys, first } = firstGeneration();
  const market = readJson(paperMarketPath(sources));
  market.delisted = true;
  writeJson(paperMarketPath(sources), market);
  const delisted = join(root, 'delisted');
  testBuild({ sources, history: first, out: delisted, keys });
  testSign({ out: delisted, history: first, keys });

  await t.test('同版本改 compatibility', () => {
    const relisted = copyPaperSource(join(tempDir(), 'relisted'));
    const relistedMarket = readJson(paperMarketPath(relisted));
    delete relistedMarket.delisted;
    relistedMarket.versions['1.0.0'].compatibility.minAppVersion = '0.3.0';
    writeJson(paperMarketPath(relisted), relistedMarket);
    assert.throws(
      () =>
        testBuild({
          sources: relisted,
          history: delisted,
          out: join(root, 'relisted-bad'),
          keys,
        }),
      /compatibility|字节|历史/
    );
  });

  await t.test('同版本字节变化', () => {
    const relisted = copyPaperSource(join(tempDir(), 'relisted'));
    const relistedMarket = readJson(paperMarketPath(relisted));
    delete relistedMarket.delisted;
    writeJson(paperMarketPath(relisted), relistedMarket);
    writeFileSync(
      join(
        relisted,
        'collabra.paper',
        'versions',
        '1.0.0',
        'README.md'
      ),
      '# changed\n'
    );
    assert.throws(
      () =>
        testBuild({
          sources: relisted,
          history: delisted,
          out: join(root, 'relisted-bytes'),
          keys,
        }),
      /字节|内容|README/
    );
  });

  await t.test('低于 ledger 最新版本', () => {
    const relisted = copyPaperSource(join(tempDir(), 'relisted'));
    const relistedMarket = readJson(paperMarketPath(relisted));
    delete relistedMarket.delisted;
    relistedMarket.versions = {
      '0.9.0': relistedMarket.versions['1.0.0'],
    };
    writeJson(paperMarketPath(relisted), relistedMarket);
    const dir = join(relisted, 'collabra.paper', 'versions');
    cpSync(join(dir, '1.0.0'), join(dir, '0.9.0'), { recursive: true });
    rmSync(join(dir, '1.0.0'), { recursive: true, force: true });
    const manifestPath = join(dir, '0.9.0', 'enso-plugin.json');
    const manifest = readJson(manifestPath);
    manifest.version = '0.9.0';
    writeJson(manifestPath, manifest);
    assert.throws(
      () =>
        testBuild({
          sources: relisted,
          history: delisted,
          out: join(root, 'relisted-low'),
          keys,
        }),
      /高于历史最新版本|历史/
    );
  });
});

test('copy 边界：build 产物中的历史 snapshot 被篡改时 sign 拒绝', () => {
  const { root, sources, keys, first } = firstGeneration();
  const next = join(root, 'next');
  testBuild({ sources, history: first, out: next, keys });
  const snapshot = join(next, 'v1', historySnapshotPath(1));
  writeFileSync(snapshot, readFileSync(snapshot, 'utf8').replace('"sequence": 1', '"sequence": 2'));
  assert.throws(() => testSign({ out: next, history: first, keys }), /签名|snapshot|历史/);
});

test('sign 边界：产物中的旧包/旧 README 被篡改或 history 被删除时拒绝', async (t) => {
  const { root, sources, keys, first } = firstGeneration();
  await t.test('旧包被篡改', () => {
    const next = join(root, 'next-zip');
    testBuild({ sources, history: first, out: next, keys });
    const path = join(next, 'v1', 'packages', 'collabra.paper', '1.0.0.zip');
    const bytes = readFileSync(path);
    bytes[bytes.length - 1] ^= 0xff;
    writeFileSync(path, bytes);
    assert.throws(
      () => testSign({ out: next, history: first, keys }),
      /ledger|哈希|包/
    );
  });
  await t.test('旧 README 被篡改', () => {
    const next = join(root, 'next-readme');
    testBuild({ sources, history: first, out: next, keys });
    writeFileSync(
      join(next, 'v1', 'readmes', 'collabra.paper', '1.0.0.md'),
      '# tampered\n'
    );
    assert.throws(
      () => testSign({ out: next, history: first, keys }),
      /ledger|哈希|README/
    );
  });
  await t.test('旧 snapshot 被删除', () => {
    const next = join(root, 'next-snapshot');
    testBuild({ sources, history: first, out: next, keys });
    rmSync(join(next, 'v1', historySnapshotPath(1)));
    assert.throws(
      () => testSign({ out: next, history: first, keys }),
      /snapshot|文件集合|缺失/
    );
  });
});

test('未在 signed ledger 中的包或历史文件不被承认为权威', async (t) => {
  const { root, sources, keys, first } = firstGeneration();
  await t.test('额外包文件', () => {
    const history = join(tempDir(), 'history');
    cpSync(first, history, { recursive: true });
    writeFileSync(
      join(history, 'v1', 'packages', 'collabra.paper', '9.9.9.zip'),
      'unverified'
    );
    assert.throws(
      () => testBuild({ sources, history, out: join(root, 'extra-package'), keys }),
      /未在 signed ledger/
    );
  });
  await t.test('额外历史文件', () => {
    const history = join(tempDir(), 'history');
    cpSync(first, history, { recursive: true });
    writeFileSync(join(history, 'v1', 'history', '999.json'), '{}');
    assert.throws(
      () => testBuild({ sources, history, out: join(root, 'extra-history'), keys }),
      /历史 snapshot|未验证/
    );
  });
});

test('relist 同版本且字节/compatibility 不变可重新上架', () => {
  const { root, sources, keys, first } = firstGeneration();
  const market = readJson(paperMarketPath(sources));
  market.delisted = true;
  writeJson(paperMarketPath(sources), market);
  const delisted = join(root, 'delisted');
  testBuild({ sources, history: first, out: delisted, keys });
  testSign({ out: delisted, history: first, keys });

  const relisted = copyPaperSource(join(tempDir(), 'relisted'));
  const relistedMarket = readJson(paperMarketPath(relisted));
  delete relistedMarket.delisted;
  writeJson(paperMarketPath(relisted), relistedMarket);
  const next = join(root, 'relisted-ok');
  const result = testBuild({ sources: relisted, history: delisted, out: next, keys });
  assert.deepEqual(
    result.index.plugins[0].versions.map((version) => version.version),
    ['1.0.0']
  );
  assert.equal(testSign({ out: next, history: delisted, keys }).sequence, 3);
});
