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
 * `RewardMoneyDifficulty` names a tier of `quest_money_reward`: `1..9` make the quest pay `Money{n}`
 * of the row for the level of the player completing it (each option shows what it pays at this
 * quest's own level), and `0` pays the fixed `RewardMoney` above.
 *
 * Imported Blizzlike quests carry the client's "money at max level" figure in this column instead.
 * The server treats any value of 10 or more as no tier, so the control says so rather than showing
 * the bare number as though it were one.
 */
export function MoneyDifficultyControl(props: ControlProps<number>): React.JSX.Element {
  const { id, label, help, value, onChange, disabled, readOnlyReason } = props;
  const aggregate = useAggregate();
  const level = typeof aggregate.values[LEVEL_FIELD] === 'number' ? (aggregate.values[LEVEL_FIELD] as number) : 0;
  const tables = useRewardTables(level);

  const notATier = !TIERS.includes(value);
  const known = notATier ? [...TIERS, value] : TIERS;

  return (
    <div>
      <label htmlFor={id}>{label}</label>
      {help && <p>{help}</p>}
      {notATier && (
        <p>
          This quest stores {value} here, which is not a tier, so the server ignores it and pays the fixed amount
          above. Imported quests often carry the client&apos;s &quot;money at max level&quot; figure in this column.
        </p>
      )}
      <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))}>
        {known.map((n) => (
          <option key={n} value={n}>
            {optionLabel(n, tables?.money[n] ?? null)}
          </option>
        ))}
      </select>
      {readOnlyReason && <p role="alert">{readOnlyReason}</p>}
    </div>
  );
}

function optionLabel(tier: number, money: number | null): string {
  if (tier === 0) return 'None: pay the fixed amount above';
  if (!TIERS.includes(tier)) return `Not a tier (stored value ${tier})`;
  return money !== null ? `${formatMoney(money)} (tier ${tier})` : `Tier ${tier}`;
}

export const MoneyDifficultyFieldControl = MoneyDifficultyControl as unknown as FieldControl;
