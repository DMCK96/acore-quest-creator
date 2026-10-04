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

/** Which texture a chunk's one layer uses: most grass, the corner two a file that is garbage and an uncompressed one. */
const textureOf = (row: number, col: number): number => (row === 0 && col === 0 ? 1 : row === 0 && col === 1 ? 2 : 0);

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
  const layers = Buffer.concat([u32(textureOf(row, col)), u32(0), u32(0), u32(0)]);
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

/** One placement of the house, at the camera's target. */
function building(): Buffer {
  const out = Buffer.alloc(64);
  out.writeUInt32LE(0, 0);
  out.writeUInt32LE(7, 4);
  out.writeFloatLE(CORNER - START.y, 8);
  out.writeFloatLE(START.z - 3.5, 12);
  out.writeFloatLE(CORNER - START.x, 16);
  return out;
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
    chunk('MTEX', Buffer.from('tileset\\grass.blp\0tileset\\garbage.blp\0tileset\\raw.blp\0')),
    chunk('MMDX', names),
    chunk('MMID', offsets),
    chunk('MDDF', Buffer.concat([doodad(0, 1), doodad(1, 2)])),
    chunk('MWMO', Buffer.from(`${HOUSE}\0`)),
    chunk('MWID', u32(0)),
    chunk('MODF', building()),
    ...chunks,
  ]);
}

/** A map whose one tile is covered by magma, above the terrain everywhere. */
export const LAVA_MAP = { directory: 'lavatest', file: 'world/maps/lavatest/lavatest_32_48.adt' };
const LAVA_LEVEL = 95;
const MAGMA = 3;

/**
 * MH2O: one instance per chunk, all 8 x 8 tiles (no bitmap), heights then depths. The chunk comes
 * straight after MHDR, so MHDR's offset to it is MHDR's own size.
 */
function lavaLiquid(): Buffer {
  const vertices = 81;
  const headers = Buffer.alloc(256 * 12);
  const bodies: Buffer[] = [];
  let at = headers.length;
  for (let i = 0; i < 256; i++) {
    headers.writeUInt32LE(at, i * 12);
    headers.writeUInt32LE(1, i * 12 + 4);
    const instance = Buffer.alloc(24);
    instance.writeUInt16LE(MAGMA, 0);
    instance.writeUInt16LE(0, 2);
    instance.writeFloatLE(LAVA_LEVEL, 4);
    instance.writeFloatLE(LAVA_LEVEL, 8);
    instance.writeUInt8(8, 14);
    instance.writeUInt8(8, 15);
    instance.writeUInt32LE(at + 24, 20);
    const data = Buffer.concat([floats(Array(vertices).fill(LAVA_LEVEL)), Buffer.alloc(vertices, 255)]);
    bodies.push(instance, data);
    at += 24 + data.length;
  }
  return chunk('MH2O', Buffer.concat([headers, ...bodies]));
}

function lavaAdt(): Buffer {
  const header = Buffer.alloc(64);
  header.writeUInt32LE(64, 40);
  const chunks: Buffer[] = [];
  for (let row = 0; row < 16; row++) for (let col = 0; col < 16; col++) chunks.push(terrainChunk(row, col));
  return Buffer.concat([
    chunk('MVER', u32(18)),
    chunk('MHDR', header),
    lavaLiquid(),
    chunk('MCIN', Buffer.alloc(4096)),
    // The same textures as the first map's tile: its terrain chunks use all three
    chunk('MTEX', Buffer.from('tileset\\grass.blp\0tileset\\garbage.blp\0tileset\\raw.blp\0')),
    ...chunks,
  ]);
}

/** LiquidType.dbc with one record, magma: drawn unlit, from a flipbook of two frames. */
function liquidTypeDbc(): Buffer {
  const strings = Buffer.from('\0Magma\0XTextures\\lava\\lava.%d.blp\0', 'latin1');
  const record = Buffer.alloc(45 * 4);
  record.writeUInt32LE(MAGMA, 0);
  record.writeUInt32LE(1, 1 * 4); // name
  record.writeUInt32LE(2, 3 * 4); // sound bank: magma
  record.writeUInt32LE(2, 14 * 4); // material: flowing
  record.writeUInt32LE(7, 15 * 4); // first texture: the flipbook
  record.writeFloatLE(0.025, 23 * 4); // first float: how fast it flows
  const header = Buffer.concat([Buffer.from('WDBC'), u32(1), u32(45), u32(record.length), u32(strings.length)]);
  return Buffer.concat([header, record, strings]);
}

/** A WDBC of `fields` 4-byte fields per record; a string cell is written to the string block. */
function stringDbc(fields: number, records: (number | string)[][]): Buffer {
  const strings: Buffer[] = [Buffer.from([0])];
  let size = 1;
  const body = Buffer.alloc(records.length * fields * 4);
  records.forEach((record, r) =>
    record.forEach((cell, f) => {
      if (typeof cell === 'string') {
        body.writeUInt32LE(size, (r * fields + f) * 4);
        const text = Buffer.from(`${cell}\0`, 'latin1');
        strings.push(text);
        size += text.length;
      } else {
        body.writeUInt32LE(cell, (r * fields + f) * 4);
      }
    }),
  );
  return Buffer.concat([Buffer.from('WDBC'), u32(records.length), u32(fields), u32(fields * 4), u32(size), body, ...strings]);
}

/** Creature display 1: the model Creature\\Test\\Test.mdx (which the fake client does not have), in skin TestSkin. */
function creatureDisplayInfoDbc(): Buffer {
  return stringDbc(16, [[1, 1, 0, 0, 0x3f800000, 255, 'TestSkin', '', '', '']]);
}

function creatureModelDataDbc(): Buffer {
  return stringDbc(28, [[1, 0, 'Creature\\Test\\Test.mdx']]);
}

/** A BLP2 of one red, DXT1: the lava's frames. */
function lavaTexture(): Buffer {
  const size = 64;
  const blocks = (size / 4) ** 2;
  const data = Buffer.alloc(blocks * 8);
  for (let i = 0; i < blocks; i++) data.set([0x00, 0xf8, 0x00, 0xf8, 0, 0, 0, 0], i * 8);
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
  // The slot after the one real level, left holding garbage: a size of four billion. The reader used to fail on it.
  out.writeUInt32LE(1172, 20 + 1 * 4);
  out.writeUInt32LE(4294791348, 84 + 1 * 4);
  return out;
}

export const HOUSE = 'World\\wmo\\test\\house.wmo';

/** A box of 8 vertices, `size` across and `height` tall, its floor at z = 0 and its centre at (x, y). */
function box(x: number, y: number, size: number, height: number): { positions: number[]; indices: number[] } {
  const positions: number[] = [];
  for (const dz of [0, height]) for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) positions.push(x + (dx * size) / 2, y + (dy * size) / 2, dz);
  const indices = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7];
  for (let i = 0; i < 4; i++) {
    const a = i, b = (i + 1) % 4;
    indices.push(a, b, b + 4, a, b + 4, a + 4);
  }
  return { positions, indices };
}

const floats = (values: number[]): Buffer => Buffer.concat(values.map(f32));
const uint16s = (values: number[]): Buffer => {
  const b = Buffer.alloc(values.length * 2);
  values.forEach((v, i) => b.writeUInt16LE(v, i * 2));
  return b;
};

/** The building's root file: two materials (the brick texture, and one the client does not have) and four groups. */
function houseRoot(): Buffer {
  const mohd = Buffer.alloc(64);
  mohd.writeUInt32LE(2, 0); // textures
  mohd.writeUInt32LE(4, 4); // groups
  const brick = 'tileset\\brick.blp\0';
  const textures = Buffer.from(`${brick}tileset\\missing.blp\0\0`);
  const empty = textures.length - 1;
  const material = (textureOffset: number): Buffer => {
    const momt = Buffer.alloc(64);
    momt.writeUInt32LE(textureOffset, 12); // first texture's offset
    momt.writeUInt32LE(empty, 24); // second: the empty string at the end
    return momt;
  };
  const group = Buffer.alloc(32);
  const names = Buffer.from('house\0');
  return Buffer.concat([
    chunk('MVER', u32(17)),
    chunk('MOHD', mohd),
    chunk('MOTX', textures),
    chunk('MOMT', Buffer.concat([material(0), material(brick.length)])),
    chunk('MOGN', names),
    chunk('MOGI', Buffer.concat([group, group, group, group])),
  ]);
}

/** One group: a box, with baked lighting when `colour` is given. */
function houseGroup(x: number, y: number, colour: number | null, options: { allSeeThrough?: boolean; oddSizes?: boolean; material?: number; water?: boolean } = {}): Buffer {
  const { positions, indices } = box(x, y, 24, 14);
  const vertexCount = positions.length / 3;
  const batch = Buffer.alloc(24);
  batch.writeUInt32LE(0, 12); // first index
  batch.writeUInt16LE(indices.length, 16);
  batch.writeUInt16LE(0, 18);
  batch.writeUInt16LE(vertexCount - 1, 20);
  batch[23] = options.material ?? 0;
  const normals = floats(Array.from({ length: vertexCount }, () => [0, 0, 1]).flat());
  const uvs = floats(Array.from({ length: vertexCount }, (_, i) => [i % 2, Math.floor(i / 2) % 2]).flat());
  const colours = Buffer.alloc(vertexCount * 4, colour ?? 0);
  // Real files state chunk sizes that are not whole numbers of floats
  const stray = options.oddSizes ? Buffer.alloc(2) : Buffer.alloc(0);
  const parts = [chunk('MOVI', uint16s(indices)), chunk('MOVT', Buffer.concat([floats(positions), stray])), chunk('MONR', Buffer.concat([normals, stray])), chunk('MOTV', uvs), chunk('MOBA', batch)];
  if (colour !== null) parts.push(chunk('MOCV', colours));
  // A pool of water inside the group (MLIQ): 3 x 3 vertices, 2 x 2 tiles of water (legacy type 0)
  if (options.water) {
    const header = Buffer.concat([u32(3), u32(3), u32(2), u32(2), floats([x - 8, y - 8, 2]), Buffer.from([0, 0])]);
    const vertices = Buffer.concat(Array.from({ length: 9 }, () => Buffer.concat([Buffer.alloc(4), f32(2)])));
    parts.push(chunk('MLIQ', Buffer.concat([header, vertices, Buffer.alloc(4, 0)])));
  }
  const header = Buffer.alloc(68);
  header.writeUInt32LE(colour === null ? 0 : 4, 8);
  // Every batch see-through: the lit vertices would begin after the last of them, and there are none
  if (options.allSeeThrough) header.writeUInt16LE(1, 40);
  return Buffer.concat([chunk('MVER', u32(17)), chunk('MOGP', Buffer.concat([header, ...parts]))]);
}

/** A BLP2 of one orange, DXT1. */
function brickTexture(): Buffer {
  const size = 64;
  const blocks = (size / 4) ** 2;
  const data = Buffer.alloc(blocks * 8);
  for (let i = 0; i < blocks; i++) data.set([0xc3, 0xca, 0xc3, 0xca, 0, 0, 0, 0], i * 8);
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

/** A BLP2 of one colour, uncompressed (blue-green-red-alpha), 8 x 8. */
function rawTexture(): Buffer {
  const size = 8;
  const data = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) data.set([200, 90, 30, 255], i * 4);
  const out = Buffer.alloc(1172 + data.length);
  out.write('BLP2');
  out.writeUInt32LE(1, 4);
  out[8] = 3;
  out[9] = 8;
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
    ['tileset/brick.blp', brickTexture()],
    ['world/wmo/test/house.wmo', houseRoot()],
    // Baked colours all black, as Ascension's Kul Tiras docks have: baked light adds to the sun, so it still shows
    ['world/wmo/test/house_000.wmo', houseGroup(0, 0, 0x00)],
    ['world/wmo/test/house_001.wmo', houseGroup(0, -40, 0x80)],
    ['world/wmo/test/house_002.wmo', houseGroup(0, -80, 0x80, { allSeeThrough: true, water: true })],
    ['world/wmo/test/house_003.wmo', houseGroup(0, -120, null, { oddSizes: true, material: 1 })],
    ['tileset/garbage.blp', Buffer.alloc(200, 0x67)],
    ['tileset/raw.blp', rawTexture()],
    ['world/bad/bad.m2', Buffer.concat([Buffer.from('MD20'), Buffer.alloc(40, 0xff)])],
    ['world/maps/lavatest/lavatest.wdt', wdt()],
    [LAVA_MAP.file, lavaAdt()],
    ['dbfilesclient/liquidtype.dbc', liquidTypeDbc()],
    ['dbfilesclient/creaturedisplayinfo.dbc', creatureDisplayInfoDbc()],
    ['dbfilesclient/creaturemodeldata.dbc', creatureModelDataDbc()],
    ['xtextures/lava/lava.1.blp', lavaTexture()],
    ['xtextures/lava/lava.2.blp', lavaTexture()],
    // The building pool's water: no such type in the fake LiquidType.dbc, so it is drawn as plain water
    ['xtextures/river/lake_a.1.blp', lavaTexture()],
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
