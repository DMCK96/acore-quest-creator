// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { RewardTablesProvider, useRewardTables } from '../../src/renderer/state/reward-tables';
import { makeMockApi } from './mock-api';

function Reader(): null {
  useRewardTables(10);
  return null;
}

describe('per-connection caches', () => {
  it('reward tables are read again when the connection changes', () => {
    const api = makeMockApi();
    const { rerender } = render(<RewardTablesProvider api={api} epoch={1}><Reader /></RewardTablesProvider>);
    rerender(<RewardTablesProvider api={api} epoch={1}><Reader /></RewardTablesProvider>);
    expect(api.rewardTables).toHaveBeenCalledTimes(1);
    rerender(<RewardTablesProvider api={api} epoch={2}><Reader /></RewardTablesProvider>);
    expect(api.rewardTables).toHaveBeenCalledTimes(2);
  });
});
