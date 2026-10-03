import { createServer, type Server } from 'node:http';

/**
 * A tiny fake 3.3.5 game client, served over HTTP: one terrain tile (Northshire's, 256 chunks of
 * rolling ground), one terrain texture, and two doodads that cannot be loaded (a model file that is
 * garbage, and one that is missing). Enough to drive the 3D view in a browser without a real client.
 */

const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};
const f32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeFloatLE(n);
  return b;
};
/** A chunk as the files store it: the tag spelt backwards, its length, its bytes. */
const chunk = (tag: string, data: Buffer): Buffer => Buffer.concat([Buffer.from([...tag].reverse().join('')), u32(data.length), data]);

const CORNER = 17066.666;
const GRID = 533.3333;
/** The tile Northshire is in: `azeroth_32_48.adt`, grid 48 north to south and 32 west to east. */
export const TILE = { areaX: 48, areaY: 32, file: 'world/maps/azeroth/azeroth_32_48.adt' };
export const START = { x: -8949.95, y: -132.49, z: 83.5 };
export const BAD_MODEL = 'World\\bad\\bad.m2';
export const MISSING_MODEL = 'World\\missing\\missing.m2';

const tileNorth = CORNER - TILE.areaX * GRID;
const tileWest = CORNER - TILE.areaY * GRID;

function wdt(): Buffer {
  const main = Buffer.alloc(64 * 64 * 8);
  main.writeUInt32LE(1, (TILE.areaX * 64 + TILE.areaY) * 8);
  return Buffer.concat([chunk('MVER', u32(18)), chunk('MPHD', Buffer.alloc(32)), chunk('MAIN', main)]);
}

function terrainChunk(row: number, col: number): Buffer {
  const heights = Buffer.alloc(145 * 4);
  for (let i = 0; i < 145; i++) {
    const k = i % 17;
    const r = Math.floor(i / 17) + (k < 9 ? 0 : 0.5);
    const c = k < 9 ? k : k - 9 + 0.5;
    heights.writeFloatLE(82 + 6 * Math.sin((row * 8 + r) / 6) * Math.cos((col * 8 + c) / 6), i * 4);
  }
  const normals = Buffer.alloc(435);
  for (let i = 0; i < 145; i++) normals.writeInt8(127, i * 3 + 2);
  const layers = Buffer.concat([u32(0), u32(0), u32(0), u32(0)]);
  const body = Buffer.concat([chunk('MCVT', heights), chunk('MCNR', normals), Buffer.alloc(13), chunk('MCLY', layers)]);
  const header = Buffer.alloc(128);
  header.writeUInt32LE(col, 4);
  header.writeUInt32LE(row, 8);
  header.writeUInt32LE(1, 12);
  header.writeUInt32LE(9, 52);
  header.writeFloatLE(tileNorth - row * (GRID / 16), 104);
  header.writeFloatLE(tileWest - col * (GRID / 16), 108);
  return chunk('MCNK', Buffer.concat([header, body]));
}

function adt(): Buffer {
  const names = Buffer.from(`${BAD_MODEL}\0${MISSING_MODEL}\0`);
  const offsets = Buffer.concat([u32(0), u32(BAD_MODEL.length + 1)]);
  const doodad = (nameId: number, id: number): Buffer =>
    Buffer.concat([u32(nameId), u32(id), f32(CORNER - START.y), f32(84), f32(CORNER - START.x), f32(0), f32(0), f32(0), Buffer.from([0, 4, 0, 0])]);
  const chunks: Buffer[] = [];
  for (let row = 0; row < 16; row++) for (let col = 0; col < 16; col++) chunks.push(terrainChunk(row, col));
  return Buffer.concat([
    chunk('MVER', u32(18)),
    chunk('MHDR', Buffer.alloc(64)),
    chunk('MCIN', Buffer.alloc(4096)),
    chunk('MTEX', Buffer.from('tileset\\grass.blp\0')),
    chunk('MMDX', names),
    chunk('MMID', offsets),
    chunk('MDDF', Buffer.concat([doodad(0, 1), doodad(1, 2)])),
    ...chunks,
  ]);
}

/** A BLP2 of one green, in the compressed form terrain uses (DXT1): every 4 x 4 block one colour. */
function grassTexture(): Buffer {
  const size = 64;
  const blocks = (size / 4) ** 2;
  const data = Buffer.alloc(blocks * 8);
  for (let i = 0; i < blocks; i++) data.set([0xa7, 0x2c, 0xa7, 0x2c, 0, 0, 0, 0], i * 8);
  const out = Buffer.alloc(1172 + data.length);
  out.write('BLP2');
  out.writeUInt32LE(1, 4);
  out[8] = 2;
  out.writeUInt32LE(size, 12);
  out.writeUInt32LE(size, 16);
  out.writeUInt32LE(1172, 20);
  out.writeUInt32LE(data.length, 84);
  data.copy(out, 1172);
  return out;
}

export interface FakeClient {
  url: string;
  /** Each request so far, as `200 path` or `404 path`. */
  requested: string[];
  close(): Promise<void>;
}

export async function startFakeClient(port = 0): Promise<FakeClient> {
  const files = new Map<string, Buffer>([
    ['world/maps/azeroth/azeroth.wdt', wdt()],
    [TILE.file, adt()],
    ['tileset/grass.blp', grassTexture()],
    ['world/bad/bad.m2', Buffer.concat([Buffer.from('MD20'), Buffer.alloc(40, 0xff)])],
  ]);
  const requested: string[] = [];
  const server: Server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '').split('?')[0]!).replace(/^\/file\//, '').toLowerCase();
    const body = files.get(path);
    requested.push(`${body ? 200 : 404} ${path}`);
    res.setHeader('access-control-allow-origin', '*');
    res.statusCode = body ? 200 : 404;
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const address = server.address();
  const bound = typeof address === 'object' && address ? address.port : port;
  return { url: `http://127.0.0.1:${bound}/file`, requested, close: () => new Promise((resolve) => server.close(() => resolve())) };
}
