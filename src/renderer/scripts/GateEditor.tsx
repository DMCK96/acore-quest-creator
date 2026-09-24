import type { SceneGate } from '@core/scripts/model';
import { CheckField, EntityField, NumberField, SelectField } from './fields';

const GATE_KINDS = [
  ['quest', 'A quest is…'],
  ['item', 'The player has an item'],
  ['team', 'The player is on a team'],
] as const;

const QUEST_STATES = [
  ['inLog', 'in the log'],
  ['objectivesDone', 'ready to hand in'],
  ['handedIn', 'already handed in'],
  ['neverTaken', 'never taken'],
] as const;

function defaultGate(kind: SceneGate['kind']): SceneGate {
  switch (kind) {
    case 'quest':
      return { kind, questId: 0, state: 'inLog', negate: false };
    case 'item':
      return { kind, item: 0, count: 1, negate: false };
    case 'team':
      return { kind, team: 'alliance' };
  }
}

/** The "Only when…" list: every gate must hold for the scene to run. */
export function GateEditor({ idPrefix, gates, onChange }: { idPrefix: string; gates: readonly SceneGate[]; onChange(next: SceneGate[]): void }): React.JSX.Element {
  const set = (i: number, gate: SceneGate): void => onChange(gates.map((g, j) => (j === i ? gate : g)));

  return (
    <div className="scene-section">
      <h4 className="scene-section__title">Only when</h4>
      {gates.length === 0 && <p className="scene-hint">Always, whoever sets it off.</p>}
      {gates.map((gate, i) => (
        <div key={i} className="scene-row">
          <SelectField label="Condition" value={gate.kind} options={GATE_KINDS} onChange={(kind) => set(i, defaultGate(kind))} />
          {gate.kind === 'quest' && (
            <>
              <NumberField label="Quest ID (0 = this quest)" value={gate.questId} onChange={(questId) => set(i, { ...gate, questId })} />
              <SelectField label="State" value={gate.state} options={QUEST_STATES} onChange={(state) => set(i, { ...gate, state })} />
              <CheckField label="Not" value={gate.negate} onChange={(negate) => set(i, { ...gate, negate })} />
            </>
          )}
          {gate.kind === 'item' && (
            <>
              <EntityField id={`${idPrefix}-gate-${i}-item`} label="Item" kind="item" value={gate.item} onChange={(item) => set(i, { ...gate, item })} />
              <NumberField label="How many" value={gate.count} min={1} onChange={(count) => set(i, { ...gate, count })} />
              <CheckField label="Not" value={gate.negate} onChange={(negate) => set(i, { ...gate, negate })} />
            </>
          )}
          {gate.kind === 'team' && (
            <SelectField label="Team" value={gate.team} options={[['alliance', 'Alliance'], ['horde', 'Horde']] as const} onChange={(team) => set(i, { ...gate, team })} />
          )}
          <button type="button" className="entry-card__btn entry-card__btn--danger" onClick={() => onChange(gates.filter((_, j) => j !== i))}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="btn" onClick={() => onChange([...gates, defaultGate('quest')])}>
        Add condition
      </button>
    </div>
  );
}
