import { SKILLS } from '@core/game/skills';
import { NamedSelect, type NamedSelectProps } from './NamedSelect';

/** A profession or secondary skill, picked by name. */
export function SkillSelect(props: NamedSelectProps): React.JSX.Element {
  return <NamedSelect {...props} options={SKILLS} />;
}
