/**
 * The services a gossip option can open, by the `OptionType` and `OptionNpcFlag` pair the database uses for
 * each (the pairs that occur in the fork's data), with the icon the client shows beside it. An option shows
 * only to an NPC whose `npcflag` has the service's flag.
 */
export interface GossipService {
  id: string;
  label: string;
  type: number;
  npcFlag: number;
  icon: number;
}

export const GOSSIP_SERVICES: readonly GossipService[] = [
  { id: 'vendor', label: 'Vendor', type: 3, npcFlag: 128, icon: 1 },
  { id: 'flight', label: 'Flight master', type: 4, npcFlag: 8192, icon: 2 },
  { id: 'trainer', label: 'Trainer', type: 5, npcFlag: 16, icon: 3 },
  { id: 'inn', label: 'Innkeeper', type: 8, npcFlag: 65536, icon: 5 },
  { id: 'bank', label: 'Banker', type: 9, npcFlag: 131072, icon: 6 },
  { id: 'petition', label: 'Petitions', type: 10, npcFlag: 262144, icon: 7 },
  { id: 'tabard', label: 'Tabard designer', type: 11, npcFlag: 524288, icon: 8 },
  { id: 'battlemaster', label: 'Battlemaster', type: 12, npcFlag: 1048576, icon: 9 },
  { id: 'auction', label: 'Auctioneer', type: 13, npcFlag: 2097152, icon: 6 },
  { id: 'stable', label: 'Stable master', type: 14, npcFlag: 4194304, icon: 0 },
  { id: 'armorer', label: 'Armorer', type: 15, npcFlag: 4096, icon: 1 },
  { id: 'unlearn', label: 'Unlearn talents', type: 16, npcFlag: 16, icon: 0 },
];

/** The named service for a type and flag pair, if the pair is one of them */
export const serviceOf = (type: number, npcFlag: number): GossipService | undefined =>
  GOSSIP_SERVICES.find((s) => s.type === type && s.npcFlag === npcFlag);

/** A pair's name, or "Other (type N, flag M)" for one this editor has no name for */
export const serviceLabel = (type: number, npcFlag: number): string => serviceOf(type, npcFlag)?.label ?? `Other (type ${type}, flag ${npcFlag})`;

/** The `npcflag` bits the editor sets from the vendor and trainer tabs, which a service option cannot give an NPC */
const MANAGED_FLAGS = 1 | 16 | 32 | 64 | 128;

/** The `npcflag` bits a tree's service options need that no other tab of a new NPC sets: the NPC is given them */
export function serviceFlagBits(tree: { menus: readonly { options: readonly { action: { kind: string; npcFlag?: number } }[] }[] } | null): number {
  let bits = 0;
  for (const menu of tree?.menus ?? []) for (const o of menu.options) if (o.action.kind === 'service') bits |= (o.action.npcFlag ?? 0) & ~MANAGED_FLAGS;
  return bits;
}
