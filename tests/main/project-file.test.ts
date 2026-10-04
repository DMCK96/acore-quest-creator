import { describe, it, expect } from 'vitest';
import {
  serializeProject, parseProject, writeFileAtomic, defaultProjectMeta, ProjectFileError,
  PROJECT_FORMAT, PROJECT_VERSION, type ProjectDocument,
} from '../../src/main/project/project-file';
import { memFs } from '../helpers/mem-fs';
import { EMPTY_WORLD } from '../../src/core/world/layer';
import { EMPTY_ENTITIES } from '../../src/core/entities/model';

const aggregate = { questId: 60001, isNew: false, values: { 'quest_template.LogTitle': "It's \\ ok\r\n🙂 \0 \u2028", creature_queststarter: [{ id: 1 }] }, readOnly: [], sharedItems: { '2000': [60002] } };
const snapshot = { questId: 60001, tables: { quest_template: [{ ID: '60001', LogTitle: null }] }, columnsRead: { quest_template: ['ID', 'LogTitle'] }, linkedContext: {}, schemaHash: 'abc' };
const doc = (over: Partial<ProjectDocument> = {}): ProjectDocument => ({
  ...defaultProjectMeta('Northshire rework', 'C:\\out'),
  viewport: { x: -120, y: 40, zoom: 0.6 },
  quests: [
    { questId: 60001, isNew: false, aggregate, snapshot, fidelity: { ok: true }, x: 320, y: -50.5, lastExportPath: 'C:\\out\\a.sql' },
    { questId: 60000, isNew: true, aggregate: { ...aggregate, questId: 60000, isNew: true }, snapshot: null, fidelity: null, x: 0, y: 0, lastExportPath: null },
  ] as ProjectDocument['quests'],
  world: EMPTY_WORLD, entities: EMPTY_ENTITIES,
  ...over,
});
const reasonOf = (fn: () => unknown): string => {
  try { fn(); } catch (e) { expect(e).toBeInstanceOf(ProjectFileError); return (e as ProjectFileError).reason; }
  throw new Error('did not throw');
};

describe('project file', () => {
  it('has sensible defaults for a new project', () => {
    expect(defaultProjectMeta('Untitled Project', 'C:\\out')).toEqual({
      name: 'Untitled Project', idRangeStart: 60000, idRangeEnd: 99999, outputDir: 'C:\\out', viewport: { x: 0, y: 0, zoom: 1 },
    });
  });

  it('round-trips every field, with quests ordered by id', () => {
    const d = doc();
    expect(parseProject(serializeProject(d))).toEqual({ ...d, quests: [d.quests[1], d.quests[0]] });
  });

  it('writes stable, readable JSON with the header first and the range as an object', () => {
    const text = serializeProject(doc());
    expect(text.startsWith(`{\n  "format": "${PROJECT_FORMAT}",\n  "version": ${PROJECT_VERSION},\n  "toolVersion": `)).toBe(true);
    expect(text.endsWith('}\n')).toBe(true);
    expect(serializeProject(parseProject(text))).toBe(text);
    const raw = JSON.parse(text);
    expect(raw.idRange).toEqual({ start: 60000, end: 99999 });
    expect(raw).not.toHaveProperty('idRangeStart');
  });

  it('refuses text that is not a project', () => {
    for (const text of ['hello', '[]', '{"format":"something-else","version":1}', '']) {
      expect(reasonOf(() => parseProject(text)), text).toBe('not-a-project');
    }
  });

  it('refuses a newer format version and says which', () => {
    const text = serializeProject(doc()).replace(`"version": ${PROJECT_VERSION}`, '"version": 7');
    expect(reasonOf(() => parseProject(text))).toBe('newer-version');
    expect(() => parseProject(text)).toThrow(/7/);
  });

  it('names the first invalid path of a corrupt project', () => {
    const raw = JSON.parse(serializeProject(doc()));
    raw.quests[0].x = 'left';
    const text = JSON.stringify(raw);
    expect(reasonOf(() => parseProject(text))).toBe('corrupt');
    expect(() => parseProject(text)).toThrow(/quests\.0\.x/);
  });

  it('writes atomically through a temporary file', async () => {
    const fs = memFs({ 'C:\\p\\a.aqc': 'old' });
    await writeFileAtomic(fs, 'C:\\p\\a.aqc', 'new');
    expect(fs.files.get('C:\\p\\a.aqc')).toBe('new');
    expect(fs.files.has('C:\\p\\a.aqc.tmp')).toBe(false);
  });

  it('leaves the original untouched when the final rename fails', async () => {
    const fs = memFs({ 'C:\\p\\a.aqc': 'old' });
    fs.failNext.rename = new Error('EBUSY: resource busy');
    await expect(writeFileAtomic(fs, 'C:\\p\\a.aqc', 'new')).rejects.toThrow(/EBUSY/);
    expect(fs.files.get('C:\\p\\a.aqc')).toBe('old');
    expect(fs.files.has('C:\\p\\a.aqc.tmp')).toBe(false);
  });
});

describe('project file: the world layer', () => {
  const world = {
    spawns: [{ kind: 'creature' as const, guid: 80330, entry: 1423, name: 'Stormwind Guard', map: 0,
      original: { x: 1, y: 2, z: 3, orientation: 0, rotation: null }, current: { x: 4, y: 2, z: 3, orientation: 1, rotation: null } }],
    routes: [{ pathId: 801, walkers: 2, name: 'Stormwind Guard', original: [{ x: 1, y: 0, z: 0, rest: { delay: '0' } }], current: [{ x: 2, y: 0, z: 0, rest: {} }] }],
    added: [
      { kind: 'creature' as const, guid: 80331, entry: 1423, name: 'Stormwind Guard', map: 0,
        placement: { x: 5, y: 6, z: 7, orientation: 2, rotation: null },
        look: { displayId: 3167, scale: 1, equipment: [1, 0, 0] as [number, number, number],
          preset: { race: 1, sex: 0, skin: 2, face: 3, hairStyle: 4, hairColour: 5, facialHair: 6,
            items: { head: 0, shoulders: 7, body: 0, chest: 8, waist: 0, legs: 9, feet: 0, wrists: 0, hands: 0, back: 0, tabard: 0 } } } },
      { kind: 'gameobject' as const, guid: 80332, entry: 2000, name: 'Tent', map: 0,
        placement: { x: 8, y: 9, z: 1, orientation: 0, rotation: [0, 0, 0, 1] as [number, number, number, number] },
        look: { displayId: 99, scale: 1.5, equipment: [0, 0, 0] as [number, number, number], preset: null } },
    ],
  };

  it('round-trips the world layer, with its placed spawns, after the quests and before the NPCs', () => {
    const text = serializeProject(doc({ world }));
    expect(parseProject(text).world).toEqual(world);
    expect(text.indexOf('"quests"')).toBeLessThan(text.indexOf('"world"'));
    expect(text.indexOf('"world"')).toBeLessThan(text.indexOf('"entities"'));
  });

  it('opens a version 2 project, saved before spawns could be placed, with none', () => {
    const raw = JSON.parse(serializeProject(doc({ world })));
    raw.version = 2;
    delete raw.world.added;
    expect(parseProject(JSON.stringify(raw)).world).toEqual({ ...world, added: [] });
  });

  it('opens a version 1 project with an empty world layer', () => {
    const raw = JSON.parse(serializeProject(doc()));
    raw.version = 1;
    delete raw.world;
    expect(parseProject(JSON.stringify(raw)).world).toEqual(EMPTY_WORLD);
  });

  it('names a corrupt world entry', () => {
    const raw = JSON.parse(serializeProject(doc({ world })));
    raw.world.spawns[0].current.x = 'north';
    expect(() => parseProject(JSON.stringify(raw))).toThrow(/world\.spawns\.0\.current\.x/);
  });
});
