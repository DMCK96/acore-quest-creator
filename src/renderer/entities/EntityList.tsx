import type { EntityChange, EntityRef, TrackedEntity } from '@core/entities/entity';
import type { ProjectEntities } from '@core/entities/model';
import { storeHas, type ProjectQuestUse } from '../state/project-entities';
import '../views/ProjectDialog.css';

const KIND_LABEL = { npc: 'NPC', object: 'Object', item: 'Item' } as const;
const CHANGE_LABEL: Record<EntityChange, string> = {
  new: 'New',
  spawns: 'Spawns changed',
  movement: 'Movement changed',
  path: 'Path changed',
  details: 'Details changed',
  group: 'Group changed',
};

/** What changed about an entity, in a few words */
export function changeSummary(changes: readonly EntityChange[]): string {
  return changes.map((c) => CHANGE_LABEL[c]).join(' · ');
}

/** Why Edit is off on an existing entity the project does not hold yet while there is no world database */
export const EDIT_NEEDS_DATABASE = 'Needs the world database';

/**
 * Which rows can be edited: all of them with the world database; without it, not an existing entity
 * the project does not hold yet, since editing one brings it in from the database first
 */
export function editableWith(store: ProjectEntities, connected: boolean): (entity: TrackedEntity) => boolean {
  return (entity) => connected || entity.origin === 'new' || storeHas(store, entity);
}

/**
 * The project's tracked entities, new ones and existing ones it changed: what each is, what changed
 * and which quests use it, with Edit and Go to. With a quest open, its entities come first.
 */
export function EntityList({
  tracked, quests, openQuestId = null, canEdit, editBlockedReason, onEdit, onGoTo, drifted = [],
}: {
  tracked: readonly TrackedEntity[];
  quests: readonly ProjectQuestUse[];
  /** With a quest open, its entities come first under "Used by this quest" */
  openQuestId?: number | null;
  /** Whether a row can be edited; every row when not given */
  canEdit?(entity: TrackedEntity): boolean;
  /** Why a row `canEdit` refuses cannot be edited, given as its Edit button's description */
  editBlockedReason?: string;
  onEdit?(ref: EntityRef): void;
  onGoTo?(entity: TrackedEntity): void;
  /** Existing entities whose rows the world database changed since the project brought them in */
  drifted?: readonly EntityRef[];
}): React.JSX.Element {
  const rows = (list: readonly TrackedEntity[]): React.JSX.Element => (
    <ul className="project-changes__list">
      {list.map((e) => (
        <EntityRow key={`${e.kind}:${e.entry}`} entity={e} quests={quests} openQuestId={openQuestId} canEdit={canEdit} editBlockedReason={editBlockedReason} onEdit={onEdit} onGoTo={onGoTo}
          drifted={drifted.some((d) => d.kind === e.kind && d.entry === e.entry)} />
      ))}
    </ul>
  );
  if (openQuestId === null) return rows(tracked);
  const mine = tracked.filter((e) => e.usedBy.includes(openQuestId));
  const others = tracked.filter((e) => !e.usedBy.includes(openQuestId));
  return (
    <>
      {mine.length > 0 && <section aria-label="Used by this quest">{rows(mine)}</section>}
      {others.length > 0 && <section aria-label="Others in the project">{rows(others)}</section>}
    </>
  );
}

function EntityRow({
  entity, quests, openQuestId, canEdit, editBlockedReason, onEdit, onGoTo, drifted,
}: {
  entity: TrackedEntity;
  editBlockedReason?: string;
  drifted: boolean;
  quests: readonly ProjectQuestUse[];
  openQuestId: number | null;
  canEdit?(entity: TrackedEntity): boolean;
  onEdit?(ref: EntityRef): void;
  onGoTo?(entity: TrackedEntity): void;
}): React.JSX.Element {
  const label = entity.name.trim() || `${KIND_LABEL[entity.kind]} ${entity.entry}`;
  const users = entity.usedBy
    .filter((id) => id !== openQuestId)
    .map((id) => {
      const quest = quests.find((q) => q.questId === id);
      return quest?.title.trim() || `Quest ${id}`;
    });
  const blocked = !(canEdit?.(entity) ?? true);
  let facts = `${KIND_LABEL[entity.kind]} ${entity.entry} · ${changeSummary(entity.changes)}`;
  if (users.length > 0) facts += ` · used by ${users.join(', ')}`;
  return (
    <li className="project-changes__entity" aria-label={label}>
      <span className="project-changes__name">{label}</span>
      <span className="project-changes__facts">{facts}</span>
      {drifted && <span className="world-changes__drift">Changed in the database since</span>}
      <span className="project-changes__actions">
        <button type="button" className="btn" disabled={!onEdit || blocked} title={blocked ? editBlockedReason : undefined} onClick={() => onEdit?.({ kind: entity.kind, entry: entity.entry })}>
          Edit
        </button>
        <button type="button" className="btn" disabled={!onGoTo || !entity.goTo} onClick={() => onGoTo?.(entity)}>
          Go to
        </button>
      </span>
    </li>
  );
}
