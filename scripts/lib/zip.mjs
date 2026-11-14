import { inflateRawSync } from 'node:zlib';
import { MAX_PACKAGE_BYTES, MAX_PACKAGE_FILES } from './constants.mjs';
import { isSafeRelativePath } from './ids.mjs';

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const END_SIG = 0x06054b50;
/** 1980-01-01 00:00:00, the earliest representable DOS timestamp. */
const DOS_DATE = 0x0021;
const DOS_TIME = 0;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Original deterministic ZIP writer. Entries are stored (method 0) so the
 * output does not depend on the local zlib version. Order, timestamps and
 * permissions are fixed.
 */
export function createZip(entries) {
  if (!Array.isArray(entries) || entries.length === 0)
    throw new Error('ZIP 至少需要一个条目');
  if (entries.length > MAX_PACKAGE_FILES)
    throw new Error(`ZIP 条目数超过 ${MAX_PACKAGE_FILES}`);
  const normalized = entries.map((entry) => {
    const path = entry?.path;
    if (!isSafeRelativePath(path)) throw new Error(`ZIP 路径不安全：${String(path)}`);
    if (path.endsWith('/')) throw new Error(`不接受目录条目：${path}`);
    const data = Buffer.from(entry.data ?? '');
    return { path, data, mode: entry.mode ?? 0o644 };
  });
  const paths = new Set();
  for (const entry of normalized) {
    if (paths.has(entry.path)) throw new Error(`ZIP 含重复路径：${entry.path}`);
    paths.add(entry.path);
  }
  normalized.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  const total = normalized.reduce((sum, entry) => sum + entry.data.length, 0);
  if (total > MAX_PACKAGE_BYTES) throw new Error('ZIP 未压缩内容超过大小上限');

  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of normalized) {
    const name = Buffer.from(entry.path, 'utf8');
    const flags = /[^\x00-\x7f]/.test(entry.path) ? 0x0800 : 0;
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIG, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((((0o100000 | entry.mode) & 0xffff) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + entry.data.length;
    if (offset > 0xffffffff) throw new Error('ZIP 超过 4GiB');
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_SIG, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(normalized.length, 8);
  end.writeUInt16LE(normalized.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

/**
 * Minimal ZIP reader used by validation/tests. Supports stored and deflated
 * entries, rejects encrypted entries, unsafe duplicate paths and oversize
 * inputs. It never extracts to disk.
 */
export function readZipEntries(bytes) {
  const buffer = Buffer.from(bytes);
  if (buffer.length < 22) throw new Error('ZIP 过短');
  let endOffset = -1;
  const floor = Math.max(0, buffer.length - 65557);
  for (let i = buffer.length - 22; i >= floor; i--) {
    if (buffer.readUInt32LE(i) === END_SIG) {
      const commentLength = buffer.readUInt16LE(i + 20);
      if (i + 22 + commentLength === buffer.length) {
        endOffset = i;
        break;
      }
    }
  }
  if (endOffset < 0) throw new Error('ZIP 缺少中央目录结尾');
  const count = buffer.readUInt16LE(endOffset + 10);
  if (count > MAX_PACKAGE_FILES) throw new Error('ZIP 条目数超限');
  const centralOffset = buffer.readUInt32LE(endOffset + 16);
  const entries = [];
  const seen = new Set();
  let cursor = centralOffset;
  let total = 0;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== CENTRAL_SIG)
      throw new Error('ZIP 中央目录损坏');
    const flags = buffer.readUInt16LE(cursor + 8);
    if (flags & 1) throw new Error('不支持加密 ZIP');
    const method = buffer.readUInt16LE(cursor + 10);
    const crc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    if (!isSafeRelativePath(name)) throw new Error(`ZIP 路径不安全：${name}`);
    if (seen.has(name)) throw new Error(`ZIP 含重复路径：${name}`);
    seen.add(name);
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== LOCAL_SIG)
      throw new Error('ZIP 本地头损坏');
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    if (compressed.length !== compressedSize) throw new Error('ZIP 数据截断');
    let data;
    if (method === 0) data = Buffer.from(compressed);
    else if (method === 8) data = inflateRawSync(compressed);
    else throw new Error(`不支持的 ZIP 压缩方法：${method}`);
    if (data.length !== size) throw new Error(`ZIP 大小不匹配：${name}`);
    if (crc32(data) !== crc) throw new Error(`ZIP CRC 不匹配：${name}`);
    total += data.length;
    if (total > MAX_PACKAGE_BYTES) throw new Error('ZIP 解压后超过大小上限');
    entries.push({ path: name, data });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
}
