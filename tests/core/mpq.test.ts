import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { MpqFormatError, openMpq, type MpqArchive } from '../../src/core/client/mpq';
import { UnsupportedCompressionError } from '../../src/core/client/decompress';
import { buildMpq, bytesSource, concat, deleteMarker, FLAG, storedFile, text, zlibFile } from '../helpers/mpq-file';

const BZIP2 = Uint8Array.from(Buffer.from('QlpoOTFBWSZTWeLwGjkAAAORgEAAIkbAACAAISgHqEMCFE4vOEokTxdyRThQkOLwGjk=', 'base64'));
const BLAST = Uint8Array.from([0x00, 0x04, 0x82, 0x24, 0x25, 0x8f, 0x80, 0x7f]);
const str = (b: Uint8Array): string => new TextDecoder().decode(b);
/** Bytes deflate cannot shrink. */
const noise = (n: number): Uint8Array => {
  let s = 12345;
  return Uint8Array.from({ length: n }, () => ((s = (s * 1103515245 + 12345) >>> 0) >>> 16) & 0xff);
};
const open = (bytes: Uint8Array): Promise<MpqArchive> => openMpq(bytesSource(bytes), 'test.MPQ');
async function readFile(mpq: MpqArchive, name: string): Promise<Uint8Array> {
  const entry = mpq.find(name);
  if (!entry || entry === 'deleted') throw new Error(`${name} not found`);
  return mpq.read(entry, name);
}

describe('MPQ archives', () => {
  it('finds a stored file by name in any letter case and with either slash', async () => {
    const mpq = await open(buildMpq([storedFile('Interface\\WorldMap\\Elwynn\\Elwynn1.blp', text('art'))]));
    expect(str(await readFile(mpq, 'interface/worldmap/ELWYNN/elwynn1.blp'))).toBe('art');
    expect(mpq.find('Interface\\WorldMap\\Elwynn\\Elwynn2.blp')).toBeNull();
  });

  it('reads zlib sectors of a v1 archive behind user data, keeping sectors that did not compress', async () => {
    const data = concat([new Uint8Array(1024), noise(276)]);
    const file = zlibFile('a\\b.bin', data, 512);
    expect(file.stored.at(-1)!.length).toBe(276);
    const mpq = await open(buildMpq([file], { version: 1, sectorShift: 0, userDataShift: 512 }));
    expect(await readFile(mpq, 'a\\b.bin')).toEqual(data);
  });

  it('decrypts encrypted files, sectored with an adjusted key and whole', async () => {
    const data = concat([new Uint8Array(700).fill(7), text('end')]);
    const mpq = await open(buildMpq([
      zlibFile('x\\secret.dbc', data, 512, FLAG.ENCRYPTED | FLAG.FIX_KEY),
      storedFile('(listfile)', text('x\\secret.dbc\r\n'), FLAG.ENCRYPTED),
    ], { sectorShift: 0 }));
    expect(await readFile(mpq, 'x\\secret.dbc')).toEqual(data);
    expect(str(await readFile(mpq, '(listfile)'))).toBe('x\\secret.dbc\r\n');
  });

  it('reads a compressed single-unit file', async () => {
    const plain = text('single unit '.repeat(30));
    const file = { name: 'one.txt', size: plain.length, stored: [Uint8Array.from([0x02, ...deflateSync(plain)])], flags: FLAG.SINGLE_UNIT | FLAG.COMPRESS };
    expect(await readFile(await open(buildMpq([file])), 'one.txt')).toEqual(plain);
  });

  it('reads bzip2 and imploded sectors', async () => {
    const mpq = await open(buildMpq([
      { name: 'b.txt', size: 19, stored: [Uint8Array.from([0x10, ...BZIP2])], flags: FLAG.COMPRESS },
      { name: 'i.txt', size: 13, stored: [BLAST], flags: FLAG.IMPLODE },
    ]));
    expect(str(await readFile(mpq, 'b.txt'))).toBe('hello map hello map');
    expect(str(await readFile(mpq, 'i.txt'))).toBe('AIAIAIAIAIAIA');
  });

  it('says when a patch deleted a file', async () => {
    const mpq = await open(buildMpq([deleteMarker('gone.blp')]));
    expect(mpq.find('gone.blp')).toBe('deleted');
  });

  it('prefers the neutral-locale copy of a file', async () => {
    const mpq = await open(buildMpq([storedFile('t.txt', text('german'), 0, 0x407), storedFile('t.txt', text('neutral'), 0, 0)]));
    expect(str(await readFile(mpq, 't.txt'))).toBe('neutral');
  });

  it('fails a sector with a compression it does not read', async () => {
    const mpq = await open(buildMpq([{ name: 'w.wav', size: 10, stored: [Uint8Array.from([0x40, 1, 2, 3])], flags: FLAG.COMPRESS }]));
    await expect(readFile(mpq, 'w.wav')).rejects.toBeInstanceOf(UnsupportedCompressionError);
  });

  it('rejects something that is not an MPQ, and one whose tables run past its end', async () => {
    await expect(open(text('not an archive at all, no'))).rejects.toBeInstanceOf(MpqFormatError);
    const cut = buildMpq([storedFile('a', text('a'))]);
    await expect(open(cut.slice(0, cut.length - 40))).rejects.toBeInstanceOf(MpqFormatError);
  });
});
