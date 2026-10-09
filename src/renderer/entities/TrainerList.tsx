import { TRAINER_TYPES, type Trainer, type TrainerSpell } from '@core/entities/model';
import { CLASSES, className } from '@core/game/classes';
import { SKILLS } from '@core/game/skills';
import { EntityField, NumberField, SelectField, TextField } from '../scripts/fields';

const NEW_SPELL: TrainerSpell = { spell: 0, cost: 0, reqLevel: 0, reqSkill: 0, reqSkillRank: 0, reqSpells: [] };
const TYPE_LABEL: Record<Trainer['type'], string> = { class: 'Class', mount: 'Mount', profession: 'Profession', pet: 'Pet' };
const GOLD = 10000;
const SILVER = 100;
/** `trainer_spell.ReqLevel` is a tinyint unsigned */
const MAX_LEVEL = 255;
/** A spell can name this many spells to know first (`ReqAbility1..3`) */
const MAX_REQ_SPELLS = 3;

/** A whole number from 0 up */
const count = (n: number): number => Math.max(0, Math.round(n));

/** What a trainer teaches, read-only: for a trainer other NPCs share */
export function TrainerSpells({ trainer }: { trainer: Trainer }): React.JSX.Element {
  return (
    <ol className="scene-steps">
      {trainer.spells.map((s, i) => (
        <li key={i} className="scene-step">
          Spell {s.spell} · {s.cost} copper · level {s.reqLevel}
        </li>
      ))}
    </ol>
  );
}

/** A trainer's type, class, greeting and the spells it teaches, each with its price and what a player needs first */
export function TrainerList({ idPrefix, trainer, onChange }: { idPrefix: string; trainer: Trainer; onChange(next: Trainer): void }): React.JSX.Element {
  const setSpell = (i: number, row: TrainerSpell): void => onChange({ ...trainer, spells: trainer.spells.map((r, j) => (j === i ? row : r)) });
  // A class trainer's class; an id the list has no name for is kept
  const classes = CLASSES.some((c) => c.id === trainer.requirement) || trainer.requirement === 0 ? CLASSES : [...CLASSES, { id: trainer.requirement, name: className(trainer.requirement) }];
  // A skill an id the list has no name for is kept
  const skillOptions = (skill: number): (readonly [string, string])[] => [
    ['0', 'None'],
    ...SKILLS.map((s) => [String(s.id), s.name] as const),
    ...(skill > 0 && !SKILLS.some((s) => s.id === skill) ? [[String(skill), `Skill ${skill}`] as const] : []),
  ];
  return (
    <div className="scene-section">
      <h4 className="scene-section__title">Trainer</h4>
      <div className="scene-row">
        <SelectField
          label="Type"
          value={trainer.type}
          options={TRAINER_TYPES.map((t) => [t, TYPE_LABEL[t]] as const)}
          onChange={(type) => onChange({ ...trainer, type, requirement: 0 })}
        />
        {trainer.type === 'class' && (
          <SelectField
            label="Class"
            value={String(trainer.requirement)}
            options={[['0', 'Choose a class'], ...classes.map((c) => [String(c.id), c.name] as const)]}
            onChange={(id) => onChange({ ...trainer, requirement: Number(id) })}
          />
        )}
      </div>
      <TextField label="Greeting" value={trainer.greeting} onChange={(greeting) => onChange({ ...trainer, greeting })} />
      <ol className="scene-steps">
        {trainer.spells.map((row, i) => (
          <li key={i} className="scene-step">
            <div className="scene-step__head">
              <strong>Spell {i + 1}</strong>
              <button type="button" className="entry-card__btn entry-card__btn--danger" onClick={() => onChange({ ...trainer, spells: trainer.spells.filter((_, j) => j !== i) })}>
                Remove
              </button>
            </div>
            <EntityField id={`${idPrefix}-trainer${i}`} label="Spell" kind="spell" value={row.spell} onChange={(spell) => setSpell(i, { ...row, spell })} />
            <div className="scene-row">
              <NumberField label="Gold" value={Math.floor(row.cost / GOLD)} min={0} onChange={(n) => setSpell(i, { ...row, cost: row.cost % GOLD + count(n) * GOLD })} />
              <NumberField label="Silver" value={Math.floor((row.cost % GOLD) / SILVER)} min={0}
                onChange={(n) => setSpell(i, { ...row, cost: Math.floor(row.cost / GOLD) * GOLD + count(n) * SILVER + (row.cost % SILVER) })} />
              <NumberField label="Copper" value={row.cost % SILVER} min={0} onChange={(n) => setSpell(i, { ...row, cost: row.cost - (row.cost % SILVER) + count(n) })} />
            </div>
            <div className="scene-row">
              <NumberField label="Required level" value={row.reqLevel} min={0} onChange={(n) => setSpell(i, { ...row, reqLevel: Math.min(MAX_LEVEL, count(n)) })} />
              <SelectField label="Skill" value={String(row.reqSkill)} options={skillOptions(row.reqSkill)} onChange={(id) => setSpell(i, { ...row, reqSkill: Number(id) })} />
              <NumberField label="Skill rank" value={row.reqSkillRank} min={0} onChange={(n) => setSpell(i, { ...row, reqSkillRank: count(n) })} />
            </div>
            {Array.from({ length: Math.min(row.reqSpells.length + 1, MAX_REQ_SPELLS) }, (_, k) => (
              <EntityField key={k} id={`${idPrefix}-trainer${i}-req${k}`} label={`Needs spell ${k + 1}`} kind="spell" value={row.reqSpells[k] ?? 0}
                onChange={(spell) => setSpell(i, { ...row, reqSpells: spell > 0 ? Object.assign([...row.reqSpells], { [k]: spell }) : row.reqSpells.filter((_, j) => j !== k) })} />
            ))}
          </li>
        ))}
      </ol>
      <button type="button" className="btn" onClick={() => onChange({ ...trainer, spells: [...trainer.spells, { ...NEW_SPELL }] })}>
        Add spell
      </button>
    </div>
  );
}
