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
import { makeMockApi, sampleOpen } from './mock-api';

/** Renders one module body over a brand new quest (level 10) with `over` applied on top. */
export async function mountBody(
  id: ModuleId,
  over: Record<string, FieldValue> = {},
  opts: { api?: Api; onChange?: Mock; links?: QuestLinks | null; readOnly?: ReadOnlyReason[]; sharedItems?: Record<string, number[]>; openMap?: (request: any) => void; openEditor?: OpenEditor } = {},
): Promise<{ onChange: Mock; api: Api }> {
  const schema = await loadSchema(forkDb(), registry.tables.map((t) => t.table));
  const a = createNewAggregate(schema, registry, 60001);
  const aggregate = { ...a, values: { ...a.values, 'quest_template.QuestLevel': 10, ...over }, readOnly: opts.readOnly ?? [], sharedItems: opts.sharedItems ?? {} };
  const api = opts.api ?? makeMockApi();
  const onChange = opts.onChange ?? vi.fn();
  const withEditor = (ui: React.ReactNode): React.ReactNode => (opts.openEditor ? <EntityEditorProvider open={opts.openEditor}>{ui}</EntityEditorProvider> : ui);
  render(
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
    </NamesProvider>,
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

/** Renders the NPC or object editor over fixed values (like `mountBody`), optionally on one tab. */
export async function mountEditor(
  values: Record<string, FieldValue>,
  state: EditorState,
  opts: { api?: Api; onChange?: Mock; tab?: string } = {},
): Promise<{ onChange: Mock; onClose: Mock }> {
  const api = opts.api ?? makeMockApi();
  const onChange = opts.onChange ?? vi.fn();
  const onClose = vi.fn();
  render(
    <NamesProvider api={api}>
      <EntityEditorHost values={values} onChange={onChange} state={state} onTab={vi.fn()} onClose={onClose} />
    </NamesProvider>,
  );
  if (opts.tab && screen.queryByRole('tab', { name: opts.tab })) await userEvent.click(screen.getByRole('tab', { name: opts.tab }));
  return { onChange, onClose };
}
