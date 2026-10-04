import { vi, type Mock } from 'vitest';
import { render } from '@testing-library/react';
import { registry } from '@core/registry';
import { createNewAggregate } from '@core/import/new-quest';
import { loadSchema } from '@core/schema/load';
import type { FieldValue } from '@core/registry/types';
import type { ReadOnlyReason } from '@core/model/aggregate';
import type { ModuleId } from '@core/modules/model';
import type { Api, QuestLinks } from '@shared/ipc';
import { ModuleBody } from '../../src/renderer/modules/ModuleBody';
import { QuestFlowView } from '../../src/renderer/views/QuestFlowView';
import type { AppStore } from '../../src/renderer/state/app-store';
import { NamesProvider } from '../../src/renderer/state/names';
import { MapOpenerProvider } from '../../src/renderer/map/MapOpener';
import { EntityEditorProvider, type OpenEditor } from '../../src/renderer/entities/EntityEditorContext';
import { EntityEditorHost, type EditorState } from '../../src/renderer/entities/EntityEditorHost';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { RewardTablesProvider } from '../../src/renderer/state/reward-tables';
import { forkDb } from '../helpers/fixtures';
import { ENTITIES_FIELD, readEntities, writeEntities } from '../../src/core/entities/model';
import { ProjectEntitiesProvider, type ProjectQuestUse } from '../../src/renderer/state/project-entities';
import type { ProjectEntities } from '../../src/core/entities/model';
import { makeMockApi, sampleOpen } from './mock-api';

/** Renders one module body over a brand new quest (level 10) with `over` applied on top. */
export async function mountBody(
  id: ModuleId,
  over: Record<string, FieldValue> = {},
  opts: {
    api?: Api; onChange?: Mock; links?: QuestLinks | null; readOnly?: ReadOnlyReason[]; sharedItems?: Record<string, number[]>; openMap?: (request: any) => void; openEditor?: OpenEditor;
    /** The project store; by default read from `over`'s old `entities` field, each made for the quest */
    entities?: ProjectEntities; quests?: ProjectQuestUse[]; setEntities?: Mock;
  } = {},
): Promise<{ onChange: Mock; api: Api }> {
  const schema = await loadSchema(forkDb(), registry.tables.map((t) => t.table));
  const a = createNewAggregate(schema, registry, 60001);
  const aggregate = { ...a, values: { ...a.values, 'quest_template.QuestLevel': 10, ...over }, readOnly: opts.readOnly ?? [], sharedItems: opts.sharedItems ?? {} };
  const api = opts.api ?? makeMockApi();
  const onChange = opts.onChange ?? vi.fn();
  const withEditor = (ui: React.ReactNode): React.ReactNode => (opts.openEditor ? <EntityEditorProvider open={opts.openEditor}>{ui}</EntityEditorProvider> : ui);
  const old = readEntities(over);
  const entities = opts.entities ?? {
    npcs: old.npcs.map((e) => ({ ...e, madeFor: 60001 })), objects: old.objects.map((e) => ({ ...e, madeFor: 60001 })), items: old.items.map((e) => ({ ...e, madeFor: 60001 })),
  };
  const project = { entities, setEntities: opts.setEntities ?? vi.fn(), quests: opts.quests ?? [], create: vi.fn(async () => ({ error: 'not here' })), remove: vi.fn(async () => null) };
  render(
    <ProjectEntitiesProvider value={project}>
    <NamesProvider api={api}>
      <RewardTablesProvider api={api}>
        {withEditor(opts.openMap ? (
          <MapOpenerProvider open={opts.openMap}>
            <ModuleBody id={id} open={sampleOpen({ questId: 60001, aggregate })} links={opts.links ?? null} onChange={onChange} onOpenQuest={vi.fn()} />
          </MapOpenerProvider>
        ) : (
          <ModuleBody id={id} open={sampleOpen({ questId: 60001, aggregate })} links={opts.links ?? null} onChange={onChange} onOpenQuest={vi.fn()} />
        ))}
      </RewardTablesProvider>
    </NamesProvider>
    </ProjectEntitiesProvider>,
  );
  return { onChange, api };
}

/** Switches an opened quest into the editor and renders the flow view with its providers. */
export function renderFlow(store: AppStore, api: Api) {
  store.getState().editQuest();
  return render(
    <NamesProvider api={api}>
      <RewardTablesProvider api={api}>
        <QuestFlowView store={store} />
      </RewardTablesProvider>
    </NamesProvider>,
  );
}

/**
 * Renders the NPC or object editor (like `mountBody`), optionally on one tab, over the project store
 * read from `values`' old `entities` field; its edits are reported as `onChange(ENTITIES_FIELD, next)`,
 * and a delete as `onDelete(kind, entry)`.
 */
export async function mountEditor(
  values: Record<string, FieldValue>,
  state: EditorState,
  opts: { api?: Api; onChange?: Mock; onDelete?: Mock; tab?: string; quests?: ProjectQuestUse[] } = {},
): Promise<{ onChange: Mock; onClose: Mock; onDelete: Mock }> {
  const api = opts.api ?? makeMockApi();
  const onChange = opts.onChange ?? vi.fn();
  const onDelete = opts.onDelete ?? vi.fn();
  const onClose = vi.fn();
  render(
    <NamesProvider api={api}>
      <EntityEditorHost entities={readEntities(values)} onChange={(next) => onChange(ENTITIES_FIELD, writeEntities(next))} quests={opts.quests ?? []}
        state={state} onTab={vi.fn()} onClose={onClose} onDelete={onDelete} />
    </NamesProvider>,
  );
  if (opts.tab && screen.queryByRole('tab', { name: opts.tab })) await userEvent.click(screen.getByRole('tab', { name: opts.tab }));
  return { onChange, onClose, onDelete };
}
