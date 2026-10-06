import type { CustomNpc, SeenBy } from './model';

/**
 * Who sees an NPC, as its `creature_template` flags say it: `flags_extra` 0x400
 * (CREATURE_FLAG_EXTRA_GHOST_VISIBILITY) for the dead only, `type_flags` 0x2
 * (CREATURE_TYPE_FLAG_VISIBLE_TO_GHOSTS) for the living and the dead. A spirit healer or spirit guide
 * (by `npcflag`) is seen only by the dead whatever its flags say.
 */

export const GHOST_ONLY_BIT = 1024;
export const VISIBLE_TO_GHOSTS_BIT = 2;
export const SPIRIT_BITS = 16384 | 32768;

type Row = Record<string, string | null | undefined>;

const num = (raw: string | null | undefined): number => {
  const n = Number(raw ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Who sees the NPC a template row describes; the server checks dead-only first */
export function seenByOf(row: Row): SeenBy {
  if ((num(row.npcflag) & SPIRIT_BITS) !== 0 || (num(row.flags_extra) & GHOST_ONLY_BIT) !== 0) return 'dead';
  return (num(row.type_flags) & VISIBLE_TO_GHOSTS_BIT) !== 0 ? 'both' : 'living';
}

/** Whether an existing NPC is a spirit healer or spirit guide, which only the dead ever see */
export function isSpiritNpc(npc: CustomNpc): boolean {
  if (npc.origin.kind !== 'existing') return false;
  return (num(npc.origin.original.creature_template?.[0]?.npcflag) & SPIRIT_BITS) !== 0;
}

/** The two flag columns for who sees it, every other bit kept from `original` */
export function seenByColumns(seenBy: SeenBy, original: Row): { flags_extra: string; type_flags: string } {
  const extra = num(original.flags_extra) & ~GHOST_ONLY_BIT;
  const type = num(original.type_flags) & ~VISIBLE_TO_GHOSTS_BIT;
  return {
    flags_extra: String(seenBy === 'dead' ? extra | GHOST_ONLY_BIT : extra),
    type_flags: String(seenBy === 'both' ? type | VISIBLE_TO_GHOSTS_BIT : type),
  };
}
