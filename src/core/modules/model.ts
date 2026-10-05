import type { ProjectEntities } from '../entities/model';
import type { FieldValue } from '../registry/types';
import type { NameBook } from '../links/component';

/** Every module a quest can be edited through, in catalog order. */
export type ModuleId =
  | 'giver'
  | 'objectives'
  | 'dialogue'
  | 'rewards'
  | 'requirements'
  | 'chain'
  | 'scripts'
  | 'entities'
  | 'timer'
  | 'behaviour'
  | 'mapMarker'
  | 'mail'
  | 'extraRewards'
  | 'advanced';

/** A quest's decoded field values, keyed by registry field id. */
export type Values = Readonly<Record<string, FieldValue>>;

/**
 * One module of the quest editor: the registry fields it owns and how it describes them in a line
 * or two. Presence, reset and issue routing are all derived from `owns`.
 */
export interface ModuleDef {
  id: ModuleId;
  label: string;
  description: string;
  kind: 'core' | 'optional';
  owns: readonly string[];
  /** `entities`: the project's NPCs, objects and items the quest uses */
  summary(values: Values, names: NameBook, entities?: ProjectEntities): string[];
}
