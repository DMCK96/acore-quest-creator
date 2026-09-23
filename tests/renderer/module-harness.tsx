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
import { NamesProvider } from '../../src/renderer/state/names';
import { RewardTablesProvider } from '../../src/renderer/state/reward-tables';
import { forkDb } from '../helpers/fixtures';
import { makeMockApi, sampleOpen } from './mock-api';

/** Renders one module body over a brand new quest (level 10) with `over` applied on top. */
export async function mountBody(
  id: ModuleId,
  over: Record<string, FieldValue> = {},
  opts: { api?: Api; onChange?: Mock; links?: QuestLinks | null; readOnly?: ReadOnlyReason[] } = {},
): Promise<{ onChange: Mock; api: Api }> {
  const schema = await loadSchema(forkDb(), registry.tables.map((t) => t.table));
  const a = createNewAggregate(schema, registry, 60001);
  const aggregate = { ...a, values: { ...a.values, 'quest_template.QuestLevel': 10, ...over }, readOnly: opts.readOnly ?? [] };
  const api = opts.api ?? makeMockApi();
  const onChange = opts.onChange ?? vi.fn();
  render(
    <NamesProvider api={api}>
      <RewardTablesProvider api={api}>
        <ModuleBody id={id} open={sampleOpen({ questId: 60001, aggregate })} links={opts.links ?? null} onChange={onChange} onOpenQuest={vi.fn()} />
      </RewardTablesProvider>
    </NamesProvider>,
  );
  return { onChange, api };
}
