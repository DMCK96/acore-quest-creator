import { describe, expect, it } from 'vitest';
import { chainOf, questMenuInfo } from '../../src/renderer/world3d/quest-context';
import { nodeOf, sampleOpen } from './mock-api';
import { newNpc } from '../../src/core/entities/model';
import type { NameBook } from '../../src/core/links/component';

const link = (to: number, owner: number) => ({ to, component: 'prevQuest' as never, owner });

describe('the open quest for the 3D menu', () => {
  it('a chain is every quest linked to it either way, left to right', () => {
    const nodes = [
      nodeOf({ questId: 1, x: 0, links: [link(2, 2)] }),
      nodeOf({ questId: 2, x: 300, links: [] }),
      nodeOf({ questId: 3, x: 150, links: [link(2, 3)] }),
      nodeOf({ questId: 4, x: 50, links: [] }),
    ];
    expect(chainOf(nodes, 2)).toEqual([1, 3, 2]);
    expect(chainOf(nodes, 4)).toEqual([4]);
    expect(chainOf(nodes, 9)).toEqual([9]);
  });

  it('lists the quest’s own NPCs first, then the project’s others, then the existing ones it names, each once, by name', () => {
    const open = sampleOpen({ questId: 60001 });
    open.aggregate.values = {
      ...open.aggregate.values,
      creature_queststarter: [{ id: 1423 }], creature_questender: [{ id: 1423 }],
      'quest_template.RequiredNpcOrGo': [{ target: { target: 'gameobject', id: 143981 }, count: 1 }],
    } as typeof open.aggregate.values;
    const store = { npcs: [{ ...newNpc(12000001, 60001), name: 'Hela' }, { ...newNpc(12000009), name: 'Vendor' }], objects: [], items: [] };
    const names: NameBook = (kind, id) => (kind === 'creature' && id === 1423 ? 'Stormwind Guard' : kind === 'gameobject' && id === 143981 ? 'Mailbox' : undefined);
    const info = questMenuInfo(open, [nodeOf({ questId: 60001 })], names, store);
    expect(info).toMatchObject({ id: 60001, title: 'Wolves', chained: false });
    expect(info.roles.givers).toEqual([{ kind: 'creature', id: 1423 }]);
    expect(info.entities).toEqual([
      { kind: 'creature', entry: 12000001, name: 'Hela', own: true },
      { kind: 'creature', entry: 12000009, name: 'Vendor', own: true },
      { kind: 'creature', entry: 1423, name: 'Stormwind Guard', own: false },
      { kind: 'object', entry: 143981, name: 'Mailbox', own: false },
    ]);
  });
});
