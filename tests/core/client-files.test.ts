import { describe, expect, it, vi } from 'vitest';
import { archiveOrder, openClient } from '../../src/core/client/client-files';
import { buildMpq, deleteMarker, storedFile, text } from '../helpers/mpq-file';
import { memClient } from '../helpers/client-fs';

const one = (name: string, body: string): Uint8Array => buildMpq([storedFile(name, text(body))]);
const str = (b: Uint8Array | null): string | null => (b ? new TextDecoder().decode(b) : null);

describe('client archive order', () => {
  it('loads base, locale, patches by suffix, then locale patches', () => {
    const expected = [
      'common.MPQ', 'common-2.MPQ', 'expansion.MPQ', 'lichking.MPQ',
      'enUS/locale-enUS.MPQ', 'enUS/lichking-locale-enUS.MPQ',
      'patch.MPQ', 'patch-2.MPQ', 'patch-3.MPQ', 'patch-A.MPQ', 'patch-C.MPQ', 'patch-CA.MPQ', 'patch-CHA.MPQ',
      'area-52/patch-D.MPQ', 'patch-P.mpq', 'patch-WB.MPQ', 'patch-WB1.MPQ', 'patch-Z.MPQ',
      'enUS/patch-enUS.MPQ', 'enUS/patch-enUS-2.MPQ', 'enUS/patch-enUS-3.MPQ',
    ];
    const shuffled = [...expected].reverse().concat(['deDE/locale-deDE.MPQ', 'area-52/readme.MPQ']);
    expect(archiveOrder(shuffled, 'enUS')).toEqual(expected);
  });
  it('lets a subfolder patch win a tie with a Data patch of the same suffix', () => {
    expect(archiveOrder(['sub/patch-D.MPQ', 'patch-D.MPQ'], 'enUS')).toEqual(['patch-D.MPQ', 'sub/patch-D.MPQ']);
  });
});

describe('client files', () => {
  it('reads the highest-priority copy of a file', async () => {
    const fs = memClient({
      '/client/Data/common.MPQ': buildMpq([storedFile('A', text('base')), storedFile('B', text('base'))]),
      '/client/Data/enUS/locale-enUS.MPQ': buildMpq([storedFile('A', text('locale')), storedFile('B', text('locale'))]),
      '/client/Data/patch-2.MPQ': one('A', 'patch-2'),
      '/client/Data/patch-CHA.MPQ': one('A', 'patch-CHA'),
      '/client/Data/area-52/patch-D.MPQ': one('A', 'area-52'),
    });
    const client = (await openClient('/client', fs))!;
    expect(str(await client.read('A'))).toBe('area-52');
    expect(str(await client.read('B'))).toBe('locale');
    expect(await client.read('C')).toBeNull();
  });
  it('reads a file that only a locale archive has', async () => {
    const fs = memClient({
      '/client/Data/common.MPQ': one('other', 'x'),
      '/client/Data/enUS/locale-enUS.MPQ': one('Interface\\WORLDMAP\\Elwynn\\Elwynn1.blp', 'art'),
    });
    expect(str(await (await openClient('/client', fs))!.read('Interface\\WorldMap\\Elwynn\\Elwynn1.blp'))).toBe('art');
  });
  it('hides a file a patch deleted', async () => {
    const fs = memClient({ '/c/Data/common.MPQ': one('C', 'old'), '/c/Data/patch.MPQ': buildMpq([deleteMarker('C')]) });
    expect(await (await openClient('/c', fs))!.read('C')).toBeNull();
  });
  it('accepts the Data folder itself, with a trailing separator', async () => {
    const fs = memClient({ '/c/Data/common.MPQ': one('A', 'yes') });
    expect(str(await (await openClient('/c/Data/', fs))!.read('A'))).toBe('yes');
    expect(str(await (await openClient('\\c\\', fs))!.read('A'))).toBe('yes');
  });
  it('reads the locale from Config.wtf', async () => {
    const fs = memClient({
      '/c/WTF/Config.wtf': 'SET gxWindow "1"\r\nSET locale "deDE"\r\n',
      '/c/Data/common.MPQ': one('x', 'x'),
      '/c/Data/deDE/locale-deDE.MPQ': one('A', 'de'),
      '/c/Data/enUS/locale-enUS.MPQ': one('A', 'en'),
    });
    const client = (await openClient('/c', fs))!;
    expect(client.locale).toBe('deDE');
    expect(str(await client.read('A'))).toBe('de');
  });
  it('skips an archive it cannot open and reports it', async () => {
    const onProblem = vi.fn();
    const fs = memClient({ '/c/Data/common.MPQ': one('A', 'fine'), '/c/Data/patch-Z.MPQ': text('garbage, not an archive') });
    const client = (await openClient('/c', fs, onProblem))!;
    expect(str(await client.read('A'))).toBe('fine');
    expect(client.archives).toEqual(['common.MPQ']);
    expect(onProblem).toHaveBeenCalledTimes(1);
    expect(onProblem.mock.calls[0]![0]).toMatch(/patch-Z\.MPQ/);
  });
  it('reports a file it cannot decode once and treats it as missing', async () => {
    const onProblem = vi.fn();
    const fs = memClient({ '/c/Data/common.MPQ': buildMpq([{ name: 'w.wav', size: 10, stored: [Uint8Array.from([0x40, 1, 2])], flags: 0x200 }]) });
    const client = (await openClient('/c', fs, onProblem))!;
    expect(await client.read('w.wav')).toBeNull();
    expect(await client.read('w.wav')).toBeNull();
    expect(onProblem).toHaveBeenCalledTimes(1);
  });
  it('is null for a folder with no archives', async () => {
    expect(await openClient('/nothing', memClient({ '/nothing/readme.txt': 'hi' }))).toBeNull();
  });
});
