import type { QuestAggregate } from '@core/model/aggregate';
import type { FieldValue } from '@core/registry/types';
import { formatMoney } from '@core/modules/summaries';
import { useRewardTables } from '../../state/reward-tables';
import { FieldSetting } from '../FieldSetting';

const LEVEL = 'quest_template.QuestLevel';
const MONEY = 'quest_template.RewardMoney';
const TIER = 'quest_template.RewardMoneyDifficulty';

/** `quest_money_reward` columns 1-8 pay something at every level; 0 and 9 are empty in the stock table. */
const TIERS = [1, 2, 3, 4, 5, 6, 7, 8];
/** What upstream AzerothCore gives most of its any-level quests (214 of 388). */
const DEFAULT_TIER = 5;
/** The levels a tier's payout is shown at, so the range is visible at a glance. */
const SAMPLE_LEVELS = [10, 40, 60, 80] as const;

const isTier = (n: number): boolean => n >= 1 && n <= 9;

/**
 * The quest's money reward, in the terms an author thinks in.
 *
 * Almost every quest pays a fixed amount (`RewardMoney`). A quest without a fixed level (level -1,
 * "the player's level": holidays, battlegrounds) can instead scale: `RewardMoneyDifficulty` 1-9
 * pays that column of `quest_money_reward` for the level of the player handing it in, and the
 * fixed amount is no longer paid. That choice is only offered where it applies, or where the quest
 * already uses a tier.
 *
 * Any other stored tier value (0, or the large numbers some imported data carries there) is no
 * tier to the server, which pays the fixed amount; it is not shown, and it is exported unchanged.
 */
export function MoneyReward({
  aggregate,
  onChange,
}: {
  aggregate: QuestAggregate;
  onChange(fieldId: string, value: FieldValue): void;
}): React.JSX.Element {
  const level = numberOf(aggregate.values[LEVEL]);
  const money = numberOf(aggregate.values[MONEY]);
  const tier = numberOf(aggregate.values[TIER]);
  const hasTierColumn = Object.prototype.hasOwnProperty.call(aggregate.values, TIER);
  const tierReadOnly = aggregate.readOnly.some((r) => r.fieldId === TIER);

  const scales = hasTierColumn && isTier(tier);
  // A negative amount is a cost the player pays; the server never scales a cost.
  const offerScaling = hasTierColumn && !tierReadOnly && money >= 0 && (level <= 0 || scales);

  return (
    <div className="money-reward">
      {offerScaling && (
        <fieldset className="money-reward__mode">
          <legend>Money reward</legend>
          <label>
            <input type="radio" name="money-mode" checked={!scales} onChange={() => onChange(TIER, 0)} />
            A fixed amount
          </label>
          <label>
            <input type="radio" name="money-mode" checked={scales} onChange={() => onChange(TIER, DEFAULT_TIER)} />
            Scales with the player&apos;s level
          </label>
        </fieldset>
      )}
      {scales ? (
        <ScalingTier tier={tier} onChange={(n) => onChange(TIER, n)} />
      ) : (
        <FieldSetting fieldId={MONEY} aggregate={aggregate} onChange={onChange} label={offerScaling ? 'Amount' : undefined} />
      )}
    </div>
  );
}

/** The tier picker for a scaling reward, with what the chosen tier pays across the level range. */
function ScalingTier({ tier, onChange }: { tier: number; onChange(n: number): void }): React.JSX.Element {
  // One lookup per sample level; the hook count is fixed, so this is a stable hook order.
  const tables = SAMPLE_LEVELS.map((level) => ({ level, tables: useRewardTables(level) }));
  const payAt = (n: number, i: number): number | null => tables[i]!.tables?.money[n] ?? null;
  const top = SAMPLE_LEVELS.length - 1;
  const options = TIERS.includes(tier) ? TIERS : [...TIERS, tier];

  const samples = SAMPLE_LEVELS.map((level, i) => ({ level, copper: payAt(tier, i) })).filter(
    (s): s is { level: (typeof SAMPLE_LEVELS)[number]; copper: number } => s.copper !== null && s.copper > 0,
  );

  return (
    <div>
      <label htmlFor="money-tier">Reward size</label>
      <p>Higher tiers pay more. The quest pays the amount for the level of the player who hands it in.</p>
      <select id="money-tier" value={tier} onChange={(e) => onChange(Number(e.target.value))}>
        {options.map((n) => {
          const most = payAt(n, top);
          return (
            <option key={n} value={n}>
              {most !== null && most > 0 ? `Tier ${n}: up to ${formatMoney(most)}` : `Tier ${n}`}
            </option>
          );
        })}
      </select>
      {samples.length > 0 && (
        <p className="money-reward__samples">
          Pays {samples.map((s) => `${formatMoney(s.copper)} at level ${s.level}`).join(', ')}.
        </p>
      )}
    </div>
  );
}

function numberOf(v: FieldValue | undefined): number {
  return typeof v === 'number' ? v : 0;
}
