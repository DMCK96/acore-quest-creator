import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool } from '../../src/main/mcp/tool';
import { mcpFixture } from '../helpers/mcp-fixture';

const newQuests = (name: string, count: number, gapMs = 0) =>
  defineTool({
    name, title: name, description: `Makes ${count} new quests, one API call each.`, input: {},
    write: { kind: 'step', label: () => `AI: ${name}` },
    run: async (_args, ctx) => {
      let last: any = { ok: true, value: null };
      for (let i = 0; i < count; i++) {
        last = await ctx.call('newQuest');
        if (gapMs) await new Promise((r) => setTimeout(r, gapMs));
      }
      return last.ok ? { ok: true, value: { done: true } } : last;
    },
  });
const nothing = defineTool({ name: 'nothing', title: 'Nothing', description: 'Changes nothing at all.', input: {}, write: { kind: 'step', label: () => 'AI: nothing' }, run: async () => ({ ok: true, value: 1 }) });
const halfway = defineTool({
  name: 'halfway', title: 'Halfway', description: 'Changes the project, then fails.', input: {}, write: { kind: 'step', label: () => 'AI: halfway' },
  run: async (_a, ctx) => { await ctx.call('newQuest'); return { ok: false, error: { code: 'VALIDATION', message: 'stop' } }; },
});
const exporter = defineTool({
  name: 'exporter', title: 'Exporter', description: 'Marks a quest exported, which is not a history step.', input: { questId: z.number() }, write: { kind: 'step', label: () => 'AI: exporter' },
  run: async ({ questId }, ctx) => { ctx.session.quests.markExported(questId, 'C:/out/x.sql'); return { ok: true, value: 1 }; },
});

describe('the write guard', () => {
  it('flushes first, makes one step labelled AI:, then tells the window', async () => {
    const { call, order, changes } = await mcpFixture([newQuests('make_two', 2)]);
    expect((await call('make_two')).isError).toBe(false);
    expect(order).toEqual(['flush', 'notify']);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.history.steps.map((s) => s.label)).toEqual(['AI: make_two']);
    expect(changes[0]!.quests).toHaveLength(2);
    expect(changes[0]!.quests.every((q) => q.aggregate !== null)).toBe(true);
    expect(changes[0]!.direction).toBe('redo');
  });

  it('keeps two simultaneous writes apart, one step each', async () => {
    const { call, changes } = await mcpFixture([newQuests('a', 2, 5), newQuests('b', 2, 5)]);
    await Promise.all([call('a'), call('b')]);
    expect(changes).toHaveLength(2);
    const ids = changes.map((c) => c.quests.map((q) => q.questId));
    expect(ids[0]).toHaveLength(2);
    expect(ids[1]).toHaveLength(2);
    expect(ids[0]!.some((id) => ids[1]!.includes(id))).toBe(false);
    expect(changes[1]!.history.steps.map((s) => s.label)).toEqual(['AI: a', 'AI: b']);
  });

  it('makes no step and sends no change when nothing changed', async () => {
    const { call, order, api } = await mcpFixture([nothing]);
    await call('nothing');
    expect(order).toEqual(['flush']);
    expect(((await api.historyList()) as any).value.steps).toEqual([]);
  });

  it('still closes and announces the step when the tool fails part-way', async () => {
    const { call, changes, api } = await mcpFixture([halfway, newQuests('after', 1)]);
    const out = await call('halfway');
    expect(out.isError).toBe(true);
    expect(out.value.code).toBe('VALIDATION');
    expect(changes).toHaveLength(1);
    await call('after');
    const list: any = await api.historyList();
    expect(list.value.steps.map((s: any) => s.label)).toEqual(['AI: halfway', 'AI: after']);
  });

  it('goes on after the flush timeout when the window never answers', async () => {
    const { call, changes } = await mcpFixture([newQuests('late', 1)], { flushTimeoutMs: 20, flush: () => new Promise(() => {}) });
    expect((await call('late')).isError).toBe(false);
    expect(changes).toHaveLength(1);
  });

  it('asks the window to reload the canvas after a change that is not a step', async () => {
    const { call, changes, api } = await mcpFixture([exporter]);
    const created: any = await api.newQuest();
    await call('exporter', { questId: created.value.questId });
    expect(changes.at(-1)!.positions).toBe(true);
    expect(changes.at(-1)!.step).toBeNull();
  });

  it('labels the step when the window did not answer the flush, so the history says it may be out of step', async () => {
    const { call, api } = await mcpFixture([newQuests('late', 1)], { flushTimeoutMs: 20, flush: () => new Promise(() => {}) });
    await call('late');
    const list: any = await api.historyList();
    expect(list.value.steps.map((s: any) => s.label)).toEqual(['AI: late (window did not answer)']);
  });

  it('gives up on a tool that hangs, closes its step and lets the next write run', async () => {
    const hang = defineTool({ name: 'hang', title: 'Hang', description: 'Never finishes.', input: {}, write: { kind: 'step', label: () => 'AI: hang' }, run: () => new Promise(() => {}) });
    const { call, api } = await mcpFixture([hang, newQuests('after', 1)], { toolTimeoutMs: 30 });
    const out = await call('hang');
    expect(out.isError).toBe(true);
    expect(out.value.message).toMatch(/did not finish/i);
    expect((await call('after')).isError).toBe(false);
    const list: any = await api.historyList();
    expect(list.value.steps.map((s: any) => s.label)).toEqual(['AI: after']);
  });

  it('sends the window the whole project when something else changed it during the write', async () => {
    const interrupted = defineTool({
      name: 'interrupted', title: 'Interrupted', description: 'Is undone from the window part-way through.', input: {},
      write: { kind: 'step', label: () => 'AI: interrupted' },
      run: async (_a, ctx) => { await ctx.call('newQuest'); await ctx.call('historyUndo'); await ctx.call('newQuest'); return { ok: true, value: 1 }; },
    });
    const { call, session, changes } = await mcpFixture([interrupted]);
    await call('interrupted');
    const last = changes.at(-1)!;
    expect(last.positions).toBe(true);
    expect(last.world).not.toBeNull();
    expect(last.entities).not.toBeNull();
    expect(last.quests.map((q) => q.questId).sort()).toEqual(session.quests.list().map((q) => q.questId).sort());
    expect(last.quests.every((q) => q.aggregate !== null)).toBe(true);
  });
});
