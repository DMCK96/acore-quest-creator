const COPPER_PER_SILVER = 100;
const COPPER_PER_GOLD = 10000;

/** An amount of copper as the game writes money: "1g 20s 50c", leaving out the zero parts; nothing to pay is "free" */
export function formatCoin(copper: number): string {
  const gold = Math.floor(copper / COPPER_PER_GOLD);
  const silver = Math.floor((copper % COPPER_PER_GOLD) / COPPER_PER_SILVER);
  const rest = copper % COPPER_PER_SILVER;
  const parts = [gold > 0 ? `${gold}g` : '', silver > 0 ? `${silver}s` : '', rest > 0 ? `${rest}c` : ''].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : 'free';
}
