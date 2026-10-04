// @ts-nocheck
/**
 * A model drawn in a look: the skins that fill its replaceable texture slots (a creature's colour, an
 * NPC's baked clothes, its hair) and which of its geosets show (one hairstyle, not all of them).
 */
import { M2_TEXTURE_COMPONENT } from '@wowserhq/format';

type ModelLookInput = {
  /** Replaceable texture slot (the M2 texture's component) → file */
  textures?: Record<number, string>;
  /** Geoset ids to show; null or absent shows them all */
  geosets?: number[] | null;
};

/** The file to load for one of the model's textures, or null to leave it blank */
const texturePathFor = (spec: { component: number; path: string }, look: ModelLookInput | undefined): string | null => {
  if (spec.component === M2_TEXTURE_COMPONENT.COMPONENT_NONE) {
    return spec.path;
  }
  return look?.textures?.[spec.component] ?? null;
};

const groupVisible = (geosetId: number, look: ModelLookInput | undefined): boolean => {
  const geosets = look?.geosets;
  return geosets === null || geosets === undefined || geosets.includes(geosetId);
};

/** The same look gives the same key, whatever order its slots and geosets were written in */
const lookKey = (look: ModelLookInput | undefined): string => {
  const textures = Object.entries(look?.textures ?? {})
    .map(([slot, path]) => [Number(slot), path])
    .sort((a, b) => a[0] - b[0]);
  const geosets = look?.geosets ? [...look.geosets].sort((a, b) => a - b) : null;
  return JSON.stringify([textures, geosets]);
};

export { groupVisible, lookKey, texturePathFor };
export type { ModelLookInput };
