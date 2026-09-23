/** The 3.3.5a professions and secondary skills (`SkillLine.dbc` IDs) a quest can require. */
const SKILL_LINES: ReadonlyArray<readonly [number, string]> = [
  [129, 'First Aid'],
  [164, 'Blacksmithing'],
  [165, 'Leatherworking'],
  [171, 'Alchemy'],
  [182, 'Herbalism'],
  [185, 'Cooking'],
  [186, 'Mining'],
  [197, 'Tailoring'],
  [202, 'Engineering'],
  [333, 'Enchanting'],
  [356, 'Fishing'],
  [393, 'Skinning'],
  [755, 'Jewelcrafting'],
  [762, 'Riding'],
  [773, 'Inscription'],
];

export const SKILLS: readonly { id: number; name: string }[] = SKILL_LINES.map(([id, name]) => ({ id, name })).sort(
  (a, b) => a.name.localeCompare(b.name),
);

const byId = new Map(SKILL_LINES);

export function skillName(id: number): string | undefined {
  return byId.get(id);
}
