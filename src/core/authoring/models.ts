import { z } from 'zod';
import { fightSchema } from '../combat/model';
import { gossipTreeSchema, lootSchema, patrolSchema, projectEntitiesSchema } from '../entities/model';
import { sceneSchema } from '../scripts/model';

/**
 * The things an assistant can author in the editor's own author-level terms. Each has a zod schema
 * (the editor's, not a copy), a one-sentence summary, and a JSON Schema generated from the zod one,
 * so a kind added to a model later shows up here with no further work.
 */

export const AUTHORING_MODELS = ['scene', 'fight', 'patrol', 'loot', 'npc', 'object', 'item', 'gossip'] as const;
export type AuthoringModel = (typeof AUTHORING_MODELS)[number];

const SUMMARIES: Record<AuthoringModel, string> = {
  scene: 'A quest scene: when something happens to an NPC, object or area, and only if some conditions hold, do these steps in order.',
  fight: "A new NPC's fight: abilities it casts on timers, reactions to what happens, and phases.",
  patrol: 'A route one spawn of a new NPC walks, with waits, pace changes and actions at its points.',
  loot: 'The items a new NPC or object drops or holds, each with a chance and a count.',
  npc: 'A new NPC for the project: its name, level, look, faction, role, spawns, loot, what it sells, what it teaches and fight.',
  object: 'A new object for the project: a chest, book, door or other thing in the world.',
  item: 'A new item for the project: its quality, level, stats, spells and text.',
  gossip: 'An NPC gossip menu tree: what it says when talked to, and options that close, open another menu or open a service window.',
};

/** A patrol as the assistant writes it: the editor chooses the path id, so it is optional here. */
export const patrolInputSchema = patrolSchema.extend({ pathId: z.number().int().optional() });

/** The zod schema a value of this model must satisfy. */
export function authoringSchema(model: AuthoringModel): z.ZodType {
  switch (model) {
    case 'scene':
      return sceneSchema;
    case 'fight':
      return fightSchema;
    case 'patrol':
      return patrolInputSchema;
    case 'loot':
      return z.array(lootSchema);
    case 'npc':
      return projectEntitiesSchema.shape.npcs.element;
    case 'object':
      return projectEntitiesSchema.shape.objects.element;
    case 'item':
      return projectEntitiesSchema.shape.items.element;
    case 'gossip':
      return gossipTreeSchema;
  }
}

export const authoringSummary = (model: AuthoringModel): string => SUMMARIES[model];

/** The models written as a part of an entity: a few fields at a time, the rest filled in by the editor. */
const PARTIAL: ReadonlySet<AuthoringModel> = new Set(['npc', 'object', 'item']);

const PARTIAL_NOTE =
  "Every field is optional: new_entity's `fields` takes any of them and the editor fills in the rest with its defaults. `entry`, `origin` and `spawns` are chosen by the editor and cannot be set in `fields` (add spawns afterwards with upsert_entity). `name` is given to new_entity on its own.";

/**
 * The model as JSON Schema. Transforms and defaults cannot be written in JSON Schema, so they
 * become free-form values (`unrepresentable: 'any'`) and the schema describes what is written
 * (`io: 'input'`); the zod schema still validates it. An NPC, object or item is written a few
 * fields at a time, so its schema does not require any.
 */
export function jsonSchemaOf(model: AuthoringModel): Record<string, unknown> {
  const schema = z.toJSONSchema(authoringSchema(model), { unrepresentable: 'any', io: 'input' }) as Record<string, unknown>;
  if (!PARTIAL.has(model)) return schema;
  const { required: _required, ...rest } = schema;
  return { ...rest, description: PARTIAL_NOTE };
}

/** Every distinct string a `kind` property is fixed to anywhere in a JSON Schema, sorted. */
export function kindsIn(jsonSchema: unknown): string[] {
  const found = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    const record = node as Record<string, unknown>;
    const kind = (record['properties'] as Record<string, unknown> | undefined)?.['kind'] as Record<string, unknown> | undefined;
    if (kind) {
      if (typeof kind['const'] === 'string') found.add(kind['const']);
      if (Array.isArray(kind['enum'])) for (const v of kind['enum']) if (typeof v === 'string') found.add(v);
    }
    Object.values(record).forEach(walk);
  };
  walk(jsonSchema);
  return [...found].sort();
}

/**
 * Every string a property of a JSON Schema can be fixed to or limited to, sorted: the `kind`s and
 * every other choice (a style, a state, a rank). A guide must name each one.
 */
export function choicesIn(jsonSchema: unknown): string[] {
  const found = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    const record = node as Record<string, unknown>;
    for (const property of Object.values((record['properties'] as Record<string, unknown> | undefined) ?? {})) {
      const limit = property as Record<string, unknown> | null;
      if (typeof limit?.['const'] === 'string') found.add(limit['const']);
      if (Array.isArray(limit?.['enum'])) for (const v of limit['enum']) if (typeof v === 'string') found.add(v);
    }
    Object.values(record).forEach(walk);
  };
  walk(jsonSchema);
  return [...found].sort();
}
