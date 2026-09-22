/**
 * Registers the special-purpose controls under their `ControlId`s. `resolve.ts` imports this
 * module for its side effects, so any field or list whose `control` names one of these ids
 * resolves to it instead of the generic scalar/list/row-set control.
 */
import { ClassMaskControl } from './ClassMaskControl';
import { registerControl } from './control-registry';
import { EmoteControl } from './EmoteControl';
import { QuestSortControl } from './QuestSortControl';
import { RaceMaskControl } from './RaceMaskControl';
import type { FieldControl } from './types';

registerControl('raceMask', RaceMaskControl as unknown as FieldControl);
registerControl('classMask', ClassMaskControl as unknown as FieldControl);
registerControl('questSort', QuestSortControl as unknown as FieldControl);
registerControl('emote', EmoteControl as unknown as FieldControl);
