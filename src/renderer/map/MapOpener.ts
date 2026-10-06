/** What the quest map is opened to do: place a new NPC or object, or draw a new NPC's patrol. */
export type MapMode =
  | { kind: 'place'; target: { kind: 'npc' | 'object'; entry: number } }
  | { kind: 'patrol'; entry: number; guid: number };
