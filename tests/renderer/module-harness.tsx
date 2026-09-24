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
import { RewardTablesProvider } from '../../src/renderer/state/reward-tables';
import { forkDb } from '../helpers/fixtures';
import { makeMockApi, sampleOpen } from './mock-api';

/** Renders one module body over a brand new quest (level 10) with `over` applied on top. */
export async function mountBody(
  id: ModuleId,
  over: Record<string, FieldValue> = {},
  opts: { api?: Api; onChange?: Mock; links?: QuestLinks | null; readOnly?: ReadOnlyReason[]; sharedItems?: Record<string, number[]>; openMap?: (request: any) => void } = {},
): Promise<{ onChange: Mock; api: Api }> {
  const schema = await loadSchema(forkDb(), registry.tables.map((t) => t.table));
  const a = createNewAggregate(schema, registry, 60001);
  const aggregate = { ...a, values: { ...a.values, 'quest_template.QuestLevel': 10, ...over }, readOnly: opts.readOnly ?? [], sharedItems: opts.sharedItems ?? {} };
  const api = opts.api ?? makeMockApi();
  const onChange = opts.onChange ?? vi.fn();
  render(
    <NamesProvider api={api}>
      <RewardTablesProvider api={api}>
        {opts.openMap ? (
          <MapOpenerProvider open={opts.openMap}>
            <ModuleBody id={id} open={sampleOpen({ questId: 60001, aggregate })} links={opts.links ?? null} onChange={onChange} onOpenQuest={vi.fn()} />
          </MapOpenerProvider>
        ) : (
          <ModuleBody id={id} open={sampleOpen({ questId: 60001, aggregate })} links={opts.links ?? null} onChange={onChange} onOpenQuest={vi.fn()} />
        )}
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
