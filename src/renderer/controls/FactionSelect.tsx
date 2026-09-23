import { REPUTATION_FACTIONS } from '@core/game/factions';
import { NamedSelect, type NamedSelectProps } from './NamedSelect';

/** A reputation faction, picked by name. */
export function FactionSelect(props: NamedSelectProps): React.JSX.Element {
  return <NamedSelect {...props} options={REPUTATION_FACTIONS} />;
}
