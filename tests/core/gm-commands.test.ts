import { describe, expect, it } from 'vitest';
import { gmCommands } from '../../src/core/testing/gm';

const base = { questId: 60001, tables: new Set<string>(), creatureTemplates: [], hasStarter: false, spawns: [], newObjectTemplates: false, escorts: false };

describe('gmCommands', () => {
  it('always offers the quest commands, and nothing to reload for an unchanged quest', () => {
    const out = gmCommands(base);
    expect(out.reload).toEqual([]);
    expect(out.restart).toEqual([]);
    expect(out.go).toEqual([]);
    expect(out.quest.map((c) => c.command)).toEqual(['.quest add 60001', '.quest complete 60001', '.quest reward 60001', '.quest remove 60001']);
  });
  it('reloads each touched table once, and each changed NPC template', () => {
    const out = gmCommands({ ...base, tables: new Set(['quest_template', 'quest_template_addon', 'creature_queststarter', 'smart_scripts', 'creature_text', 'conditions', 'gossip_menu', 'gossip_menu_option', 'npc_text', 'page_text', 'areatrigger_scripts']), creatureTemplates: [12000001] });
    expect(out.reload.map((c) => c.command)).toEqual([
      '.reload all quest', '.reload smart_scripts', '.reload creature_text', '.reload conditions', '.reload all gossips',
      '.reload page_text', '.reload all area', '.reload creature_template 12000001',
    ]);
  });
  it('says what needs a restart and why', () => {
    const out = gmCommands({ ...base, tables: new Set(['creature', 'gameobject', 'waypoints']), newObjectTemplates: true, escorts: true });
    expect(out.restart.map((r) => r.reason)).toEqual([
      'New spawns appear after a server restart: the server loads spawns when it starts.',
      'New objects appear after a server restart: object templates cannot be reloaded.',
      'Escort paths change after a server restart: SmartAI reads them when the server starts.',
    ]);
  });
  it('goes to the quest giver and to every new spawn', () => {
    const out = gmCommands({ ...base, hasStarter: true, spawns: [{ name: 'Scout Hela', map: 0, x: -8913.25, y: -136.5, z: 80.5 }] });
    expect(out.go).toEqual([
      { command: '.go quest starter 60001', label: 'The quest giver' },
      { command: '.go xyz -8913.25 -136.5 80.5 0', label: 'Scout Hela' },
    ]);
  });
  it('reloads patrol routes and says a new patrol needs a restart', () => {
    const out = gmCommands({ questId: 60001, tables: new Set(['creature', 'creature_addon', 'waypoint_data']), creatureTemplates: [], hasStarter: false, spawns: [], newObjectTemplates: false, escorts: false });
    expect(out.reload).toContainEqual({ command: '.reload waypoint_data', label: 'Patrol routes' });
    expect(out.restart).toContainEqual({ reason: 'A new or changed patrol starts after a server restart: the server reads which spawn walks which route when it starts.' });
  });
});
