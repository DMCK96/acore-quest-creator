import { describe, it, expect } from 'vitest';
import {
  serializeProject, parseProject, writeFileAtomic, defaultProjectMeta, ProjectFileError,
  PROJECT_FORMAT, PROJECT_VERSION, type ProjectDocument,
} from '../../src/main/project/project-file';
import { memFs } from '../helpers/mem-fs';

const aggregate = { questId: 60001, isNew: false, values: { 'quest_template.LogTitle': "It's \\ ok\r\n🙂 \0 \u2028", creature_queststarter: [{ id: 1 }] }, readOnly: [], sharedItems: { '2000': [60002] } };
const snapshot = { questId: 60001, tables: { quest_template: [{ ID: '60001', LogTitle: null }] }, columnsRead: { quest_template: ['ID', 'LogTitle'] }, linkedContext: {}, schemaHash: 'abc' };
const doc = (over: Partial<ProjectDocument> = {}): ProjectDocument => ({
  ...defaultProjectMeta('Northshire rework', 'C:\\out'),
  viewport: { x: -120, y: 40, zoom: 0.6 },
  quests: [
    { questId: 60001, isNew: false, aggregate, snapshot, fidelity: { ok: true }, x: 320, y: -50.5, lastExportPath: 'C:\\out\\a.sql' },
    { questId: 60000, isNew: true, aggregate: { ...aggregate, questId: 60000, isNew: true }, snapshot: null, fidelity: null, x: 0, y: 0, lastExportPath: null },
  ] as ProjectDocument['quests'],
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
