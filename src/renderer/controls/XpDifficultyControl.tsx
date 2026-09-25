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
  // The amounts come from `questxp_dbc` or, as that table is usually empty, the server's QuestXP.dbc.
  const amountsMissing = !scalesWithPlayer && tables !== null && tables.xp.every((xp) => xp === null);

  return (
    <div className="control">
      <label htmlFor={id} className="control__label">{label}</label>
      {help && <p className="control__help">{help}</p>}
      {scalesWithPlayer && <p className="control__note">This quest has no fixed level, so the XP depends on the player&apos;s level and no fixed amount can be shown.</p>}
      {amountsMissing && (
        <p className="control__help">
          To see how much XP each tier gives, set the server data folder on the connection. The server reads these
          amounts from its QuestXP.dbc file.
        </p>
      )}
      <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))}>
        {known.map((n) => {
          const xp = scalesWithPlayer ? null : (tables?.xp[n] ?? null);
          return (
            <option key={n} value={n}>
              {optionLabel(n, xp)}
            </option>
          );
        })}
      </select>
      {readOnlyReason && <p role="alert" className="control__alert">{readOnlyReason}</p>}
    </div>
  );
}

/** `0` pays nothing; any other tier leads with its XP when the quest level makes it known. */
function optionLabel(tier: number, xp: number | null): string {
  if (tier === 0) return 'No XP';
  return xp !== null ? `${xp.toLocaleString()} XP (tier ${tier})` : `Tier ${tier}`;
}

export const XpDifficultyFieldControl = XpDifficultyControl as unknown as FieldControl;
