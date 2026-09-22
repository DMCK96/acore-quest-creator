import { useAggregate } from '../state/aggregate-context';
import { useRewardTables } from '../state/reward-tables';
import type { ControlProps, FieldControl } from './types';

const LEVEL_FIELD = 'quest_template.QuestLevel';
const TIERS = Array.from({ length: 10 }, (_, i) => i);

/** Formats a copper amount as "1 gold 50 silver", omitting zero units, or "free" for zero. */
function formatMoney(copper: number): string {
  if (copper === 0) return 'free';
  const gold = Math.floor(copper / 10000);
  const silver = Math.floor((copper % 10000) / 100);
  const rest = copper % 100;
  const parts: string[] = [];
  if (gold) parts.push(`${gold} gold`);
  if (silver) parts.push(`${silver} silver`);
  if (rest) parts.push(`${rest} copper`);
  return parts.length > 0 ? parts.join(' ') : 'free';
}

/**
 * `RewardMoneyDifficulty` names a tier of `quest_money_reward` (indexed by quest level, not player
 * level): `0` means "the server falls back to the fixed `RewardMoney` above", and `1..9` pick
 * `Money{n}` of the row for this quest's level. Each option shows what that tier actually pays.
 */
export function MoneyDifficultyControl(props: ControlProps<number>): React.JSX.Element {
  const { id, label, help, value, onChange, disabled, readOnlyReason } = props;
  const aggregate = useAggregate();
  const level = typeof aggregate.values[LEVEL_FIELD] === 'number' ? (aggregate.values[LEVEL_FIELD] as number) : 0;
  const tables = useRewardTables(level);

  const known = TIERS.includes(value) ? TIERS : [...TIERS, value];

  return (
    <div>
      <label htmlFor={id}>{label}</label>
      {help && <p>{help}</p>}
      <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))}>
        {known.map((n) => {
          if (n === 0) {
            return (
              <option key={n} value={n}>
                0 — use the fixed amount above
              </option>
            );
          }
          const money = tables?.money[n] ?? null;
          return (
            <option key={n} value={n}>
              {money !== null ? `${n} — ${formatMoney(money)}` : `${n}`}
            </option>
          );
        })}
      </select>
      {readOnlyReason && <p role="alert">{readOnlyReason}</p>}
    </div>
  );
}

export const MoneyDifficultyFieldControl = MoneyDifficultyControl as unknown as FieldControl;
