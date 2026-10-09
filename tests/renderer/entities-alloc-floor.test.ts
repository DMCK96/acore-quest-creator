import { describe, expect, it } from 'vitest';
import { aboveHeld, heldIds } from '../../src/renderer/entities/alloc-floor';
import { EMPTY_ENTITIES, newNpc } from '../../src/core/entities/model';

describe('ids the editor holds that the app has not saved yet', () => {
  const menu = (menuId: number, textId: number) => ({ menuId, textId, locked: false, greeting: [{ text: 'Hi', textFemale: '', probability: 1 }], options: [] });
  const entities = { ...EMPTY_ENTITIES, npcs: [{ ...newNpc(1), gossipMenu: { menus: [menu(932535, 9780013), menu(932536, 9780014)] } }, { ...newNpc(2), trainer: { trainerId: 2000000005, type: 'class' as const, requirement: 1, greeting: '', spells: [] } }] };

  it('are listed by kind', () => {
    expect(heldIds('gossipMenu', entities)).toEqual([932535, 932536]);
    expect(heldIds('gossipText', entities)).toEqual([9780013, 9780014]);
    expect(heldIds('trainer', entities)).toEqual([2000000005]);
    expect(heldIds('creature', entities)).toEqual([]);
  });
  it('lift an allocation that would hand them out again, keeping the run of ids together', () => {
    expect(aboveHeld([932535, 932536], [932535, 932536])).toEqual([932537, 932538]);
    expect(aboveHeld([932700], [932536])).toEqual([932700]);
    expect(aboveHeld([5], [])).toEqual([5]);
  });
});
