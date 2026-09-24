import type { ModuleId } from '@core/modules/model';
import type { ModuleBodyComponent, ModuleBodyProps } from './body-props';
import { GiverBody } from './bodies/GiverBody';
import { ObjectivesBody } from './bodies/ObjectivesBody';
import { DialogueBody } from './bodies/DialogueBody';
import { RewardsBody } from './bodies/RewardsBody';
import { RequirementsBody } from './bodies/RequirementsBody';
import { ChainBody } from './bodies/ChainBody';
import { ScriptsBody } from './bodies/ScriptsBody';
import { TimerBody } from './bodies/TimerBody';
import { BehaviourBody } from './bodies/BehaviourBody';
import { AdvancedBody, ExtraRewardsBody, MailBody, MapMarkerBody } from './bodies/SimpleBodies';

export type { ModuleBodyProps } from './body-props';

/** The panel content of each module. */
export const MODULE_BODIES: Record<ModuleId, ModuleBodyComponent> = {
  giver: GiverBody,
  objectives: ObjectivesBody,
  dialogue: DialogueBody,
  rewards: RewardsBody,
  requirements: RequirementsBody,
  chain: ChainBody,
  scripts: ScriptsBody,
  timer: TimerBody,
  behaviour: BehaviourBody,
  mapMarker: MapMarkerBody,
  mail: MailBody,
  extraRewards: ExtraRewardsBody,
  advanced: AdvancedBody,
};

export function ModuleBody({ id, ...props }: ModuleBodyProps & { id: ModuleId }): React.JSX.Element {
  const Body = MODULE_BODIES[id];
  return <Body {...props} />;
}
