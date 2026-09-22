// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { registry } from '@core/registry';
import { resolveControl, controlRegistry } from '../../src/renderer/controls/resolve';
import { GROUP_LAYOUT } from '../../src/renderer/groups/layout';

/**
 * These assert *resolvability*: that a control exists for every definition. That is not the same
 * as reachability — a column can resolve to a control no panel ever renders, which is how the
 * linked loot/quest-item columns went unreachable while this file stayed green. Reachability is
 * asserted against the rendered tree in `linked-column-reachability.test.tsx`.
 */
describe('control coverage', () => {
  it('resolves a designed control for every field, list member and row-set column', () => {
    for (const f of registry.fields) {
      expect(() => resolveControl(f), f.id).not.toThrow();
      if (f.shape === 'list') for (const m of f.members) expect(() => resolveControl(m as any), `${f.id}.${m.name}`).not.toThrow();
      if (f.shape === 'rowset') for (const c of f.columns) expect(() => resolveControl(c as any), `${f.id}.${c.name}`).not.toThrow();
    }
  });
  it('has a registered control for every control id used by the registry', () => {
    const used = new Set(registry.fields.map((f) => f.control).filter(Boolean));
    for (const id of used) expect(controlRegistry[id!], String(id)).toBeTypeOf('function');
  });
  it('lists only real field ids in the group layouts', () => {
    const ids = new Set(registry.fields.map((f) => f.id));
    for (const [group, list] of Object.entries(GROUP_LAYOUT)) for (const id of list) expect(ids.has(id), `${group}: ${id}`).toBe(true);
  });
});
