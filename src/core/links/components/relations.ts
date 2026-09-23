import { instanceId, type ComponentInstance, type Endpoint, type LinkEdit, type RowRef } from '../model';
import { endpointName } from '../describe';
import type { ComponentDef, RecogniseInput, WriteTarget } from '../component';
import type { EventStarter } from '../facts';

/**
 * Who offers a quest and what gates whether it is available at all: NPC and object givers straight
 * off `*_queststarter`, the same givers scoped to a game event, and the row count in `conditions`
 * that a fork's condition system evaluates on its own. `gate.condition` never writes — the rows it
 * counts are edited through the conditions system itself, not through this catalog.
 */

function makeStarterComponent(spec: {
  id: 'start.npc' | 'start.object';
  label: string;
  table: string;
  entryKind: 'creature' | 'gameobject';
  paramName: 'npc' | 'object';
  starters: (facts: import('../facts').QuestFacts) => number[];
}): ComponentDef {
  return {
    id: spec.id,
    label: spec.label,
    help: spec.label,
    hook: 'start',
    action: 'offerQuest',
    mechanism: 'questRelations',
    params: [
      { name: spec.paramName, label: spec.paramName === 'npc' ? 'NPC' : 'Object', type: { kind: 'idRef', target: spec.entryKind } },
      { name: 'quest', label: 'Quest', type: { kind: 'idRef', target: 'quest' } },
    ],
    requires: [{ table: spec.table, columns: ['id', 'quest'] }],
    writable: true,
    recognise(input: RecogniseInput): ComponentInstance[] {
      const instances: ComponentInstance[] = [];
      for (const facts of input.facts.values()) {
        for (const entry of spec.starters(facts)) {
          const claim: RowRef = { table: spec.table, key: `id=${entry},quest=${facts.questId}` };
          const from: Endpoint = { kind: spec.entryKind, entry };
          instances.push({
            id: instanceId(spec.id, [claim]),
            component: spec.id,
            owner: facts.questId,
            from,
            to: { kind: 'quest', questId: facts.questId },
            params: { [spec.paramName]: entry, quest: facts.questId },
            claims: [claim],
            editable: true,
          });
        }
      }
      return instances;
    },
    write(params, target: WriteTarget): LinkEdit[] {
      const entry = params[spec.paramName] as number;
      const quest = params.quest as number;
      const existing = spec.starters(target.facts(quest) ?? {
        questId: quest, isNew: false, prevQuestId: 0, nextQuestId: 0, rewardNextQuest: 0, breadcrumbFor: 0,
        exclusiveGroup: 0, creatureStarters: [], objectStarters: [], creatureEnders: [], objectEnders: [],
        eventStarters: [], availabilityConditions: 0,
      });
      if (existing.includes(entry)) return [];
      const value = [...existing, entry].sort((a, b) => a - b).map((id) => ({ id }));
      return [{ questId: quest, fieldId: spec.table, value }];
    },
    describe(instance, names): string {
      return `Offered by ${endpointName(instance.from, names)}`;
    },
  };
}

const startNpc = makeStarterComponent({
  id: 'start.npc', label: 'Offered by an NPC', table: 'creature_queststarter', entryKind: 'creature', paramName: 'npc',
  starters: (f) => f.creatureStarters,
});

const startObject = makeStarterComponent({
  id: 'start.object', label: 'Offered by an object', table: 'gameobject_queststarter', entryKind: 'gameobject', paramName: 'object',
  starters: (f) => f.objectStarters,
});

const EVENT_TABLE: Record<EventStarter['kind'], string> = {
  creature: 'game_event_creature_quest',
  gameobject: 'game_event_gameobject_quest',
};

const startGameEvent: ComponentDef = {
  id: 'start.gameEvent',
  label: 'Offered during a game event',
  help: 'Offered during a game event',
  hook: 'start',
  action: 'offerQuest',
  mechanism: 'questRelations',
  params: [
    { name: 'eventEntry', label: 'Event', type: { kind: 'int' } },
    { name: 'giver', label: 'Giver', type: { kind: 'int' } },
    { name: 'quest', label: 'Quest', type: { kind: 'idRef', target: 'quest' } },
  ],
  requires: [
    { table: 'game_event_creature_quest', columns: ['eventEntry', 'id', 'quest'] },
    { table: 'game_event_gameobject_quest', columns: ['eventEntry', 'id', 'quest'] },
  ],
  writable: true,
  recognise(input: RecogniseInput): ComponentInstance[] {
    const instances: ComponentInstance[] = [];
    for (const facts of input.facts.values()) {
      for (const starter of facts.eventStarters) {
        const table = EVENT_TABLE[starter.kind];
        const claim: RowRef = { table, key: `eventEntry=${starter.eventEntry},id=${starter.id},quest=${facts.questId}` };
        const from: Endpoint = { kind: starter.kind, entry: starter.id };
        instances.push({
          id: instanceId('start.gameEvent', [claim]),
          component: 'start.gameEvent',
          owner: facts.questId,
          from,
          to: { kind: 'quest', questId: facts.questId },
          params: { eventEntry: starter.eventEntry, giver: starter.id, quest: facts.questId, kind: starter.kind },
          claims: [claim],
          editable: true,
        });
      }
    }
    return instances;
  },
  write(params, target: WriteTarget): LinkEdit[] {
    const eventEntry = params.eventEntry as number;
    const giver = params.giver as number;
    const quest = params.quest as number;
    const kind = params.kind as EventStarter['kind'];
    const table = EVENT_TABLE[kind];
    const facts = target.facts(quest);
    const existing = (facts?.eventStarters ?? []).filter((s) => s.kind === kind);
    if (existing.some((s) => s.eventEntry === eventEntry && s.id === giver)) return [];
    const rows = [...existing, { eventEntry, id: giver, kind }]
      .sort((a, b) => a.eventEntry - b.eventEntry || a.id - b.id)
      .map((s) => ({ eventEntry: s.eventEntry, id: s.id }));
    return [{ questId: quest, fieldId: table, value: rows }];
  },
  describe(instance, names): string {
    const eventEntry = instance.params.eventEntry as number;
    return `Offered by ${endpointName(instance.from, names)} during game event ${eventEntry}`;
  },
};

const gateCondition: ComponentDef = {
  id: 'gate.condition',
  label: 'Availability condition',
  help: 'Availability condition',
  hook: 'availability',
  action: 'gateQuest',
  mechanism: 'conditions',
  params: [
    { name: 'quest', label: 'Quest', type: { kind: 'idRef', target: 'quest' } },
    { name: 'count', label: 'Count', type: { kind: 'int' } },
  ],
  requires: [{ table: 'conditions', columns: ['SourceTypeOrReferenceId', 'SourceEntry'] }],
  writable: true,
  recognise(input: RecogniseInput): ComponentInstance[] {
    const instances: ComponentInstance[] = [];
    for (const facts of input.facts.values()) {
      if (facts.availabilityConditions <= 0) continue;
      const claim: RowRef = { table: 'conditions', key: `SourceTypeOrReferenceId=19,SourceEntry=${facts.questId}` };
      instances.push({
        id: instanceId('gate.condition', [claim]),
        component: 'gate.condition',
        owner: facts.questId,
        from: { kind: 'conditions' },
        to: { kind: 'quest', questId: facts.questId },
        params: { quest: facts.questId, count: facts.availabilityConditions },
        claims: [claim],
        editable: true,
      });
    }
    return instances;
  },
  describe(instance): string {
    const count = instance.params.count as number;
    return `Only available when ${count} condition${count === 1 ? '' : 's'} hold${count === 1 ? 's' : ''}`;
  },
};

export const RELATION_COMPONENTS: readonly ComponentDef[] = [startNpc, startObject, startGameEvent, gateCondition];
