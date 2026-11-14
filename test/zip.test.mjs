import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_PACKAGE_FILES } from '../scripts/lib/constants.mjs';
import { crc32, createZip, readZipEntries } from '../scripts/lib/zip.mjs';

test('CRC32 标准向量', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(crc32(Buffer.alloc(0)), 0);
});

test('ZIP 写入顺序、时间戳与权限确定，且可读回', () => {
  const a = createZip([
    { path: 'themes/paper.json', data: '{"light":true}' },
    { path: 'README.md', data: '# Paper\n' },
    { path: 'LICENSE', data: 'MIT\n' },
  ]);
  const b = createZip([
    { path: 'LICENSE', data: 'MIT\n' },
    { path: 'README.md', data: '# Paper\n' },
    { path: 'themes/paper.json', data: '{"light":true}' },
  ]);
  assert.deepEqual(a, b);
  const entries = readZipEntries(a);
  assert.deepEqual(
    entries.map((entry) => entry.path),
    ['LICENSE', 'README.md', 'themes/paper.json']
  );
  assert.equal(entries.find((entry) => entry.path === 'README.md').data.toString(), '# Paper\n');
});

test('ZIP 支持非 ASCII 文件名并保留 UTF-8 标志', () => {
  const zip = createZip([{ path: '说明/主题.json', data: '{}' }]);
  const entries = readZipEntries(zip);
  assert.equal(entries[0].path, '说明/主题.json');
  assert.equal(zip.readUInt16LE(6) & 0x0800, 0x0800);
});

test('拒绝越界、绝对、重复与目录条目', () => {
  for (const entries of [
    [{ path: '../secret', data: 'x' }],
    [{ path: '/etc/passwd', data: 'x' }],
    [{ path: 'C:/x', data: 'x' }],
    [{ path: 'a\\b', data: 'x' }],
    [{ path: 'a/', data: 'x' }],
    [
      { path: 'a.txt', data: 'x' },
      { path: 'a.txt', data: 'y' },
    ],
    [],
  ]) {
    assert.throws(() => createZip(entries));
  }
  assert.throws(() => createZip(Array.from({ length: MAX_PACKAGE_FILES + 1 }, (_, i) => ({
    path: `f${i}.txt`,
    data: 'x',
  }))));
});

test('读取时发现 CRC 或结构篡改即失败', () => {
  const zip = createZip([{ path: 'a.txt', data: 'hello' }]);
  const tampered = Buffer.from(zip);
  const dataOffset = 30 + Buffer.byteLength('a.txt');
  tampered[dataOffset] ^= 0xff;
  assert.throws(() => readZipEntries(tampered), /CRC/);
  assert.throws(() => readZipEntries(zip.subarray(0, zip.length - 10)), /中央目录结尾/);
});
