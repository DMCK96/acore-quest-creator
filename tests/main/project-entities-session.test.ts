import { describe, expect, it } from 'vitest';
import { createProjectSession } from '../../src/main/project/session';
import { defaultProjectMeta, parseProject, serializeProject, PROJECT_VERSION, type ProjectDocument } from '../../src/main/project/project-file';
import { EMPTY_WORLD } from '../../src/core/world/layer';
import { EMPTY_ENTITIES, ENTITIES_FIELD, newNpc } from '../../src/core/entities/model';

const fresh = () => { let n = 0; let t = 0; return createProjectSession(defaultProjectMeta('P', 'C:\\out'), () => `s${++n}`, { now: () => (t += 10_000) }); };
const store = (name: string) => ({ ...EMPTY_ENTITIES, npcs: [{ ...newNpc(12000001), name }] });

describe('the project store in the session', () => {
  it('a put is a change and a step; the same store again is neither', () => {
    const s = fresh();
    s.entities.put(store('Hela'));
    expect([s.dirty(), s.revision()]).toEqual([true, 1]);
    s.entities.put(store('Hela'));
    expect(s.revision()).toBe(1);
    expect(s.history.peekUndo()!.parts).toEqual([{ kind: 'entities', before: EMPTY_ENTITIES, after: store('Hela') }]);
  });

  it('undo and redo put the store back', () => {
    const s = fresh();
    s.entities.put(store('Hela'));
    s.applyStep(s.history.undo()!, 'undo');
    expect(s.entities.get()).toEqual(EMPTY_ENTITIES);
    s.applyStep(s.history.redo()!, 'redo');
    expect(s.entities.get().npcs[0]!.name).toBe('Hela');
  });

  it('hands out copies', () => {
    const s = fresh();
    s.entities.put(store('Hela'));
    s.entities.get().npcs[0]!.name = 'X';
    expect(s.entities.get().npcs[0]!.name).toBe('Hela');
  });

  it('saves and loads the store in the document, and a reset empties it', () => {
    const s = fresh();
    s.entities.put(store('Hela'));
    expect(s.toDocument().entities).toEqual(store('Hela'));
    const t = fresh();
    t.load(s.toDocument(), null, { dirty: false });
    expect(t.entities.get()).toEqual(store('Hela'));
    t.reset(defaultProjectMeta('Q', 'C:\\out'));
    expect(t.entities.get()).toEqual(EMPTY_ENTITIES);
  });
});

describe('project file version 4', () => {
  const doc = (over: Partial<ProjectDocument> = {}): ProjectDocument => ({ ...defaultProjectMeta('P', 'C:\\out'), quests: [], world: EMPTY_WORLD, entities: store('Hela'), ...over });

  it('is version 4 and round-trips the store', () => {
    expect(PROJECT_VERSION).toBeGreaterThanOrEqual(4);
    expect(parseProject(serializeProject(doc())).entities).toEqual(store('Hela'));
  });

  it('opens a version 3 project with its quests\' entities moved into the store', () => {
    const old = newNpc(12000001);
    const v3 = JSON.parse(serializeProject(doc({ entities: EMPTY_ENTITIES })));
    v3.version = 3;
    delete v3.entities;
    v3.quests = [{ questId: 60001, isNew: true, x: 0, y: 0, lastExportPath: null, fidelity: null, snapshot: null,
      aggregate: { questId: 60001, isNew: true, values: { [ENTITIES_FIELD]: { npcs: [{ ...old, name: 'Hela' }], objects: [], items: [] } }, readOnly: [], sharedItems: {} } }];
    const opened = parseProject(JSON.stringify(v3));
    expect(opened.entities.npcs.map((n) => n.name)).toEqual(['Hela']);
    expect(opened.entities.npcs[0]).not.toHaveProperty('madeFor');
    expect(opened.quests[0]!.aggregate.values).not.toHaveProperty(ENTITIES_FIELD);
    expect(opened.migrationWarnings).toEqual([]);
  });
});
