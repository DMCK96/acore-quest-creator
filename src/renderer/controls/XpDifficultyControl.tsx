import { useAggregate } from '../state/aggregate-context';
import { useRewardTables } from '../state/reward-tables';
import type { ControlProps, FieldControl } from './types';

const LEVEL_FIELD = 'quest_template.QuestLevel';
const DIFFICULTIES = Array.from({ length: 10 }, (_, i) => i);

/**
 * `RewardXPDifficulty` indexes `QuestXP.dbc`'s `Exp[]` directly (difficulty `n` pays `Exp[n]`), so
 * each option is labelled with the XP that difficulty actually gives at this quest's level.
 *
 * A quest whose level is not fixed (`QuestLevel <= 0`, meaning "the player's own level") has no
 * single number to show, since the table is read per player level at play time, not at the quest's
 * own level; the control says so and falls back to plain difficulty numbers.
 */
export function XpDifficultyControl(props: ControlProps<number>): React.JSX.Element {
  const { id, label, help, value, onChange, disabled, readOnlyReason } = props;
  const aggregate = useAggregate();
  const level = typeof aggregate.values[LEVEL_FIELD] === 'number' ? (aggregate.values[LEVEL_FIELD] as number) : 0;
  const scalesWithPlayer = level <= 0;
  const tables = useRewardTables(level);

  const known = DIFFICULTIES.includes(value) ? DIFFICULTIES : [...DIFFICULTIES, value];

  return (
    <div>
      <label htmlFor={id}>{label}</label>
      {help && <p>{help}</p>}
      {scalesWithPlayer && <p>The XP depends on the player&apos;s level, so no fixed amount can be shown.</p>}
      <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))}>
        {known.map((n) => {
          const xp = scalesWithPlayer ? null : (tables?.xp[n] ?? null);
          return (
            <option key={n} value={n}>
              {xp !== null ? `${n} — ${xp} XP` : `${n}`}
            </option>
          );
        })}
      </select>
      {readOnlyReason && <p role="alert">{readOnlyReason}</p>}
    </div>
  );
}

export const XpDifficultyFieldControl = XpDifficultyControl as unknown as FieldControl;
