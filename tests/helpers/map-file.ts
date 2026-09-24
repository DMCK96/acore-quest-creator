/** Builds a `.map` file (MAPS v9) with a height section and optional holes. */
export function buildMapFile(opts: {
  kind: 'flat' | 'float' | 'uint16';
  gridHeight: number; gridMaxHeight?: number;
  v9?: (i: number, j: number) => number; v8?: (i: number, j: number) => number;
  holes?: Uint16Array;
}): Uint8Array {
  const headerSize = 44;
  const heightHeaderSize = 16;
  const cell = opts.kind === 'float' ? 4 : 2;
  const dataSize = opts.kind === 'flat' ? 0 : (129 * 129 + 128 * 128) * cell;
  const holesSize = opts.holes ? 16 * 16 * 2 : 0;
  const heightOffset = headerSize;
  const holesOffset = heightOffset + heightHeaderSize + dataSize;
  const bytes = new Uint8Array(holesOffset + holesSize);
  const view = new DataView(bytes.buffer);
  bytes.set([0x4d, 0x41, 0x50, 0x53]); // MAPS
  view.setUint32(4, 9, true);
  view.setUint32(8, 0, true);
  view.setUint32(12, 0, true); view.setUint32(16, 0, true);
  view.setUint32(20, heightOffset, true); view.setUint32(24, heightHeaderSize + dataSize, true);
  view.setUint32(28, 0, true); view.setUint32(32, 0, true);
  view.setUint32(36, opts.holes ? holesOffset : 0, true); view.setUint32(40, holesSize, true);
  bytes.set([0x4d, 0x48, 0x47, 0x54], heightOffset); // MHGT
  const flags = opts.kind === 'flat' ? 1 : opts.kind === 'uint16' ? 2 : 0;
  view.setUint32(heightOffset + 4, flags, true);
  view.setFloat32(heightOffset + 8, opts.gridHeight, true);
  view.setFloat32(heightOffset + 12, opts.gridMaxHeight ?? opts.gridHeight, true);
  let at = heightOffset + heightHeaderSize;
  const put = (v: number) => {
    if (opts.kind === 'float') view.setFloat32(at, v, true); else view.setUint16(at, v, true);
    at += cell;
  };
  if (opts.kind !== 'flat') {
    for (let i = 0; i < 129; i++) for (let j = 0; j < 129; j++) put(opts.v9!(i, j));
    for (let i = 0; i < 128; i++) for (let j = 0; j < 128; j++) put(opts.v8!(i, j));
  }
  if (opts.holes) for (let k = 0; k < 256; k++) view.setUint16(holesOffset + k * 2, opts.holes[k]!, true);
  return bytes;
}
