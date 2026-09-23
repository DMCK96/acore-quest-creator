/**
 * Registers the special-purpose controls under their `ControlId`s. `resolve.ts` imports this
 * module for its side effects, so any field or list whose `control` names one of these ids
 * resolves to it instead of the generic scalar/list/row-set control.
 */
import { ClassMaskControl } from './ClassMaskControl';
import { registerControl } from './control-registry';
import { EmoteControl } from './EmoteControl';
import { EndersControl } from './EndersControl';
import { PoiControl } from './PoiControl';
import { QuestSortControl } from './QuestSortControl';
import { RaceMaskControl } from './RaceMaskControl';
import { StartersControl } from './StartersControl';
import type { FieldControl } from './types';
import { XpDifficultyControl } from './XpDifficultyControl';
// `ConditionsControl` lives under `groups/` (it composes `resolveControl` for the raw columns).
// The module graph this creates (register.ts -> groups/conditions.tsx -> controls/resolve.ts ->
// register.ts) is safe because none of these modules call `resolveControl` at module-evaluation
// time, only inside components, and `resolveControl` is a hoisted function declaration.
import { ConditionsControl } from '../groups/conditions';

registerControl('raceMask', RaceMaskControl as unknown as FieldControl);
registerControl('classMask', ClassMaskControl as unknown as FieldControl);
registerControl('questSort', QuestSortControl as unknown as FieldControl);
registerControl('emote', EmoteControl as unknown as FieldControl);
registerControl('xpDifficulty', XpDifficultyControl as unknown as FieldControl);
registerControl('starters', StartersControl as unknown as FieldControl);
registerControl('enders', EndersControl as unknown as FieldControl);
registerControl('poi', PoiControl as unknown as FieldControl);
registerControl('conditions', ConditionsControl as unknown as FieldControl);
