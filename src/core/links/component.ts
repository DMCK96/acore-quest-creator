import type { ScalarType } from '../registry/types';
import type {
  ActionKind, ComponentId, ComponentInstance, HookKind, LinkContext, LinkEdit,
  Mechanism, ParamValue,
} from './model';
import type { QuestFacts } from './facts';

/**
 * The shared shape every quest-link component implements, and the inputs a component's `recognise`
 * and `write` are given. A component reads facts already batched for a set of quests (`RecogniseInput`)
 * and, when it can be edited from the UI, writes back through field IDs the registry understands
 * (`WriteTarget`, `LinkEdit`) rather than raw SQL.
 */

export interface ParamDef {
  name: string;
  label: string;
  type: ScalarType;
}

export interface SchemaRequirement {
  table: string;
  columns: readonly string[];
}

export interface RecogniseInput {
  facts: ReadonlyMap<number, QuestFacts>;
  context: LinkContext;
}

/** How a component's `write` looks up another quest's facts, e.g. to avoid clobbering an existing link. */
export interface WriteTarget {
  facts(questId: number): QuestFacts | undefined;
}

export type NameKind = 'quest' | 'creature' | 'gameobject' | 'item';

/** Looks up a display name for a world entity; undefined means the editor has no name cached for it. */
export type NameBook = (kind: NameKind, id: number) => string | undefined;

export interface ComponentDef {
  id: ComponentId;
  label: string;
  help: string;
  hook: HookKind;
  action: ActionKind;
  mechanism: Mechanism;
  params: readonly ParamDef[];
  requires: readonly SchemaRequirement[];
  writable: boolean;
  recognise(input: RecogniseInput): ComponentInstance[];
  write?(params: Record<string, ParamValue>, target: WriteTarget): LinkEdit[];
  describe(instance: ComponentInstance, names: NameBook): string;
}
