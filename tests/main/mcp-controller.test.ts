import { describe, expect, it } from 'vitest';
import { openStore } from '../../src/main/store/store';
import { createMcpSettings } from '../../src/main/mcp/settings';
import { createMcpController } from '../../src/main/mcp/controller';

const box = { encrypt: (s: string) => Uint8Array.from(Buffer.from(s)), decrypt: (b: Uint8Array) => Buffer.from(b).toString() };
function setup(listen?: (o: { port: number; token: () => string }) => Promise<{ port: number; close(): Promise<void> }>) {
  const events: string[] = [];
  const settings = createMcpSettings(openStore(':memory:', box));
  const controller = createMcpController({
    settings,
    listen: listen ?? (async (o) => { events.push(`listen ${o.port}`); return { port: o.port, close: async () => { events.push(`close ${o.port}`); } }; }),
  });
  return { controller, events, settings };
}

describe('the MCP controller', () => {
  it('is off until configured, and start does nothing while disabled', async () => {
    const { controller, events } = setup();
    expect((await controller.start()).running).toBe(false);
    expect(events).toEqual([]);
  });

  it('starts on configure, reports the url and token, and stops when switched off', async () => {
    const { controller, events, settings } = setup();
    const on = await controller.configure({ enabled: true, port: 50000 });
    expect(on).toMatchObject({ enabled: true, running: true, port: 50000, url: 'http://127.0.0.1:50000/mcp', error: null });
    expect(on.token).toBe(settings.token());
    const off = await controller.configure({ enabled: false, port: 50000 });
    expect(off.running).toBe(false);
    expect(events).toEqual(['listen 50000', 'close 50000']);
  });

  it('restarts on a new port', async () => {
    const { controller, events } = setup();
    await controller.configure({ enabled: true, port: 50000 });
    await controller.configure({ enabled: true, port: 50001 });
    expect(events).toEqual(['listen 50000', 'close 50000', 'listen 50001']);
  });

  it('turns itself off and says why when the port is taken', async () => {
    const { controller, settings } = setup(async () => { throw new Error('Port 50000 is already in use.'); });
    const out = await controller.configure({ enabled: true, port: 50000 });
    expect(out).toMatchObject({ enabled: false, running: false, error: 'Port 50000 is already in use.' });
    expect(settings.read().enabled).toBe(false);
  });

  it('regenerates the token without restarting the server', async () => {
    const { controller, events } = setup();
    const before = await controller.configure({ enabled: true, port: 50000 });
    const after = await controller.regenerateToken();
    expect(after.token).not.toBe(before.token);
    expect(events).toEqual(['listen 50000']);
  });

  it('starts at launch when it was left enabled, and stops on quit', async () => {
    const { controller, settings, events } = setup();
    settings.setEnabled(true);
    settings.setPort(50002);
    expect((await controller.start()).running).toBe(true);
    expect(events).toEqual(['listen 50002']);
    await controller.stop();
    expect(events).toEqual(['listen 50002', 'close 50002']);
  });

  it('does not leave the server running when it is switched off while it is still starting', async () => {
    const events: string[] = [];
    let finish!: () => void;
    const starting = new Promise<void>((resolve) => { finish = resolve; });
    const settings = createMcpSettings(openStore(':memory:', box));
    const controller = createMcpController({
      settings,
      listen: async (o) => { await starting; events.push(`listen ${o.port}`); return { port: o.port, close: async () => { events.push(`close ${o.port}`); } }; },
    });
    const on = controller.configure({ enabled: true, port: 50000 });
    const off = controller.configure({ enabled: false, port: 50000 });
    finish();
    await on;
    const last = await off;
    expect(last).toMatchObject({ enabled: false, running: false });
    expect(controller.status().running).toBe(false);
    expect(events).toEqual(['listen 50000', 'close 50000']);
  });

  it('starts and reports while off on a machine with no secure storage, with an empty token', async () => {
    const noKeyring = { encrypt: () => { throw new Error('no secure storage'); }, decrypt: () => { throw new Error('no secure storage'); } };
    const controller = createMcpController({ settings: createMcpSettings(openStore(':memory:', noKeyring)), listen: async (o) => ({ port: o.port, close: async () => {} }) });
    expect(await controller.start()).toMatchObject({ enabled: false, running: false, token: '', error: null });
    expect(controller.status().token).toBe('');
  });

  it('turns itself off and says why when there is no secure storage to hold the token', async () => {
    const noKeyring = { encrypt: () => { throw new Error('no secure storage'); }, decrypt: () => { throw new Error('no secure storage'); } };
    const controller = createMcpController({ settings: createMcpSettings(openStore(':memory:', noKeyring)), listen: async (o) => ({ port: o.port, close: async () => {} }) });
    const out = await controller.configure({ enabled: true, port: 50000 });
    expect(out).toMatchObject({ enabled: false, running: false });
    expect(out.error).toMatch(/no secure storage/);
  });

  it('reports and applies the wiki switch whether or not the server runs, off by default', async () => {
    const { controller } = setup();
    expect(controller.status().wikiLookups).toBe(false);
    expect(controller.wikiEnabled()).toBe(false);
    const out = await controller.configure({ enabled: false, port: 50000, wikiLookups: true });
    expect(out).toMatchObject({ running: false, wikiLookups: true });
    expect(controller.wikiEnabled()).toBe(true);
    const kept = await controller.configure({ enabled: true, port: 50000 });
    expect(kept.wikiLookups).toBe(true);
    await controller.configure({ enabled: true, port: 50000, wikiLookups: false });
    expect(controller.wikiEnabled()).toBe(false);
  });

  it('does not restart the running server when only the wiki switch changes', async () => {
    const { controller, events } = setup();
    await controller.configure({ enabled: true, port: 50000 });
    await controller.configure({ enabled: true, port: 50000, wikiLookups: true });
    expect(events).toEqual(['listen 50000']);
    expect(controller.status()).toMatchObject({ running: true, wikiLookups: true });
  });

  it('still restarts when the port changes alongside the wiki switch', async () => {
    const { controller, events } = setup();
    await controller.configure({ enabled: true, port: 50000 });
    await controller.configure({ enabled: true, port: 50001, wikiLookups: true });
    expect(events).toEqual(['listen 50000', 'close 50000', 'listen 50001']);
  });
});
