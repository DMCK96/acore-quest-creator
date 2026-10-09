import { applyPreset, PRESETS as FIGHT_PRESETS } from '../combat/presets';
import { describeFight } from '../combat/describe';
import { newItem, newNpc, newObject, newSpawn } from '../entities/model';
import { describeScene } from '../scripts/describe';
import { presetScene, PRESETS as SCENE_PRESETS, type QuestFacts } from '../scripts/presets';
import type { AuthoringModel } from './models';

/** One worked example of a model: a value that satisfies its schema, and what it means in words. */
export interface AuthoringExample {
  title: string;
  value: unknown;
  reading: string;
}

/** A quest started by an innkeeper and ended by a smith, with a kobold as its first objective. */
const FACTS: QuestFacts = {
  questId: 1,
  starter: { kind: 'creature', entry: 295 },
  ender: { kind: 'creature', entry: 54 },
  firstNpcObjective: 6,
};

const point = (x: number, waitSecs: number, actions: unknown[] = []) => ({ x, y: 30, z: 200, waitSecs, facing: null, paceFromHere: null, actions });

function patrolExample(): AuthoringExample {
  const value = {
    startPace: 'walk',
    points: [
      point(-9460, 0),
      point(-9440, 5, [{ id: 'p1', afterSecs: 1, kind: 'say', lines: [{ text: 'All quiet.', style: 'say' }], chance: 100 }]),
      point(-9420, 0),
    ],
  };
  return {
    title: 'A guard walking a short beat',
    value,
    reading: 'Walks 3 points and loops back to where it started; pauses 5 seconds at the second and says "All quiet." there.',
  };
}

function lootExample(): AuthoringExample {
  const value = [
    { item: 769, chance: 50, min: 1, max: 2, questOnly: false },
    { item: 1015, chance: 10, min: 1, max: 1, questOnly: false },
    { item: 1234, chance: 100, min: 1, max: 1, questOnly: true },
  ];
  return {
    title: 'A common drop, a rare drop and a quest item',
    value,
    reading: value.map((r) => `item ${r.item} at ${r.chance}%${r.questOnly ? ' (quest only)' : ''}`).join('; '),
  };
}

function npcExample(): AuthoringExample {
  const value = {
    ...newNpc(90001),
    name: 'Captain Rellick',
    subname: 'Keeper of the Oath',
    minLevel: 12,
    maxLevel: 12,
    faction: 14,
    displayId: 1000,
    rank: 'elite' as const,
    spawns: [{ ...newSpawn(90100), x: -9460, y: 30, z: 200, o: 3.1416 }],
    vendor: [
      { item: 159, maxCount: 0, restockSecs: 0, extendedCost: 0 },
      { item: 4540, maxCount: 5, restockSecs: 900, extendedCost: 0 },
    ],
  };
  return {
    title: 'An elite level 12 humanoid, hostile to all, with one spawn and two things to sell',
    value,
    reading: 'Captain Rellick, an elite level 12 humanoid hostile to all, standing at one spawn facing south. He sells item 159 without limit and five of item 4540, restocked every 15 minutes.',
  };
}

function trainerExample(): AuthoringExample {
  const value = {
    ...newNpc(90004),
    name: 'Magister Orrin',
    subname: 'Mage Trainer',
    minLevel: 30,
    maxLevel: 30,
    faction: 35,
    displayId: 1000,
    spawns: [{ ...newSpawn(90101), x: -9470, y: 34, z: 200, o: 0 }],
    trainer: {
      // Only the shape: a real id comes from allocate_ids (kind trainer)
      trainerId: 2000000001,
      type: 'class' as const,
      requirement: 8,
      greeting: 'Hello, mage! Ready for some training?',
      spells: [
        { spell: 133, cost: 100, reqLevel: 4, reqSkill: 0, reqSkillRank: 0, reqSpells: [] },
        { spell: 145, cost: 400, reqLevel: 8, reqSkill: 0, reqSkillRank: 0, reqSpells: [133] },
      ],
    },
  };
  return {
    title: 'A friendly mage trainer with two spells',
    value,
    reading: 'Magister Orrin, a friendly level 30 mage trainer. He teaches spell 133 at level 4 for 1 silver, and spell 145 at level 8 for 4 silver once spell 133 is known.',
  };
}

function gossipExample(): AuthoringExample {
  // Only the shape: real ids come from allocate_ids (kinds gossipMenu and gossipText)
  const value = {
    menus: [
      {
        menuId: 2000000001,
        textId: 2000000002,
        locked: false,
        greeting: [{ text: 'Welcome, traveller. What can I do for you?', textFemale: '', probability: 1 }],
        options: [
          { optionId: 0, icon: 1, text: 'Let me browse your goods.', action: { kind: 'service' as const, type: 3, npcFlag: 128 }, kept: false },
          { optionId: 1, icon: 0, text: 'Tell me about this place.', action: { kind: 'menu' as const, menuId: 2000000003 }, kept: false },
        ],
      },
      {
        menuId: 2000000003,
        textId: 2000000004,
        locked: false,
        greeting: [{ text: 'The old road runs north, past the mill.', textFemale: '', probability: 1 }],
        options: [{ optionId: 0, icon: 0, text: 'Thank you.', action: { kind: 'close' as const }, kept: false }],
      },
    ],
  };
  return { title: 'A shopkeeper who talks about the place', value, reading: 'Greets with one line. Offers a vendor window, or a second menu about the place that ends with a thank-you that closes the window.' };
}

function objectExample(): AuthoringExample {
  const value = { ...newObject(90002), name: "Rellick's Strongbox", type: 'chest' as const, displayId: 259, spawns: [{ ...newSpawn(90200), x: -9462, y: 32, z: 200 }] };
  return { title: 'A chest with one spawn', value, reading: "Rellick's Strongbox, a chest standing at one spawn." };
}

function itemExample(): AuthoringExample {
  const value = {
    ...newItem(90003),
    name: "Rellick's Oathblade",
    description: 'Forged from a fallen captain\'s vow.',
    quality: 'epic' as const,
    itemClass: 2,
    subclass: 7,
    inventoryType: 13,
    itemLevel: 20,
    requiredLevel: 15,
    bonding: 'equip' as const,
    damage: [{ min: 20, max: 36, school: 0 }],
    delayMs: 2400,
    stats: [{ type: 4, value: 5 }, { type: 7, value: 6 }],
  };
  return { title: 'An epic one-handed sword', value, reading: "Rellick's Oathblade, an epic one-handed sword of item level 20 (damage 20–36, speed 2.4) that binds when equipped." };
}

/** The examples for a model; each `value` satisfies the model's schema. Built from the editor's presets where it has them. */
export function examplesOf(model: AuthoringModel): AuthoringExample[] {
  switch (model) {
    case 'scene':
      return SCENE_PRESETS.filter((p) => p.id !== 'blank').map((p) => {
        const value = presetScene(p.id, FACTS, 's1');
        return { title: p.label, value, reading: describeScene(value) };
      });
    case 'fight':
      return FIGHT_PRESETS.map((p) => {
        const value = applyPreset(null, p.id);
        return { title: p.label, value, reading: describeFight(value).join('\n') };
      });
    case 'patrol':
      return [patrolExample()];
    case 'loot':
      return [lootExample()];
    case 'npc':
      return [npcExample(), trainerExample()];
    case 'object':
      return [objectExample()];
    case 'item':
      return [itemExample()];
    case 'gossip':
      return [gossipExample()];
  }
}
