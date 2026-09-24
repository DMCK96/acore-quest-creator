/** A BLP2 file with one mip level; `data` is mip 0 exactly as stored. */
export function buildBlp(opts: {
  width: number;
  height: number;
  compression: 'palette' | 'dxt1' | 'dxt3' | 'dxt5' | 'raw';
  alphaDepth?: number;
  /** BGRA entries. */
  palette?: [number, number, number, number][];
  data: Uint8Array;
}): Uint8Array {
  const out = new Uint8Array(1172 + opts.data.length);
  const v = new DataView(out.buffer);
  out.set([0x42, 0x4c, 0x50, 0x32]);
  v.setUint32(4, 1, true);
  out[8] = opts.compression === 'palette' ? 1 : opts.compression === 'raw' ? 3 : 2;
  out[9] = opts.alphaDepth ?? (opts.compression === 'raw' ? 8 : 0);
  out[10] = opts.compression === 'dxt3' ? 1 : opts.compression === 'dxt5' ? 7 : 0;
  out[11] = 0;
  v.setUint32(12, opts.width, true);
  v.setUint32(16, opts.height, true);
  v.setUint32(20, 1172, true);
  v.setUint32(84, opts.data.length, true);
  (opts.palette ?? []).forEach((c, i) => out.set(c, 148 + i * 4));
  out.set(opts.data, 1172);
  return out;
}

/** A raw BLP of one colour (RGBA given, stored as BGRA). */
export function solidBlp(width: number, height: number, [r, g, b, a]: [number, number, number, number]): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([b, g, r, a], i * 4);
  return buildBlp({ width, height, compression: 'raw', data });
}
