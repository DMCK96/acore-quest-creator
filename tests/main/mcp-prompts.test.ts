import { describe, expect, it } from 'vitest';
import { PROMPT_RULES, allPrompts } from '../../src/main/mcp/prompts';
import { allTools } from '../../src/main/mcp/tools';
import { mcpFixture } from '../helpers/mcp-fixture';

const ARGS: Record<string, Record<string, string>> = {
  quest_chain: { zone: 'Elwynn Forest', minLevel: '8', maxLevel: '12', theme: 'kobold trouble' },
  legendary_item: { idea: "a sword forged from a fallen paladin's oath" },
  populate_place: { map: '0', x: '-9465', y: '30', what: 'two guards and a notice board' },
};
const ORDER: Record<string, string[]> = {
  quest_chain: ['find_zone', 'quests_in_zone', 'quest_summaries', 'area_overview', 'wiki_search', 'check_names', 'check_ids', 'new_quest', 'set_quest_fields', 'add_spawn', 'set_scene', 'validate_quest', 'preview_changes'],
  legendary_item: ['wiki_search', 'check_names', 'new_entity', 'set_npc_fight', 'set_loot', 'new_quest', 'set_quest_fields', 'validate_quest', 'check_project_entities'],
  populate_place: ['area_overview', 'check_names', 'new_entity', 'add_spawn', 'check_project_entities'],
};
const toolNames = new Set(allTools.map((t) => t.name));

describe('the prompts', () => {
  it('are the three the assistant is offered', () => {
    expect(allPrompts.map((p) => p.name).sort()).toEqual(['legendary_item', 'populate_place', 'quest_chain']);
  });

  it('open with the rules the assistant always works by', () => {
    expect(PROMPT_RULES).toBe(
      'Work in the user\'s open project. Every change you make is one undoable step labelled "AI:". You never write to the world database. Ask before exporting. If an idea borrows from a later expansion, say where it comes from.',
    );
  });

  it.each(allPrompts)('$name opens with the rules, substitutes its arguments and names its tools in order', (prompt) => {
    const text = prompt.text(ARGS[prompt.name]!);
    expect(text.startsWith(PROMPT_RULES)).toBe(true);
    for (const value of Object.values(ARGS[prompt.name]!)) expect(text).toContain(value);
    let from = 0;
    for (const tool of ORDER[prompt.name]!) {
      const at = text.indexOf(`\`${tool}\``, from);
      expect(at, `${prompt.name}: ${tool} after position ${from}`).toBeGreaterThanOrEqual(0);
      from = at;
    }
  });

  it.each(allPrompts)('$name names only tools that exist', (prompt) => {
    const text = prompt.text(ARGS[prompt.name]!);
    const named = [...text.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1]!);
    expect(named.length).toBeGreaterThan(3);
    for (const name of named) expect(toolNames.has(name), name).toBe(true);
  });

  it("say the wiki step can be skipped when lookups are off, and that exporting needs the user's say-so", () => {
    const chain = allPrompts.find((p) => p.name === 'quest_chain')!.text(ARGS.quest_chain!);
    expect(chain).toMatch(/turned (them )?off|lookups are off|is off/i);
    expect(chain).toMatch(/ask before exporting|ask .* before exporting/i);
  });

  it('legendary_item asks for confirmation of an outline before building anything', () => {
    const text = allPrompts.find((p) => p.name === 'legendary_item')!.text(ARGS.legendary_item!);
    expect(text).toMatch(/outline/i);
    expect(text).toMatch(/before building anything/i);
  });

  it('populate_place tells the assistant to match the facing of the neighbours', () => {
    const text = allPrompts.find((p) => p.name === 'populate_place')!.text(ARGS.populate_place!);
    expect(text).toMatch(/orientation/);
    expect(text).toMatch(/neighbour/i);
  });
});

describe('the server offers the prompts', () => {
  it('lists them, and getting one returns its text with the arguments in it', async () => {
    const { client } = await mcpFixture(allTools, { prompts: allPrompts });
    const listed = await client.listPrompts();
    expect(listed.prompts.map((p) => p.name).sort()).toEqual(['legendary_item', 'populate_place', 'quest_chain']);
    const got = await client.getPrompt({ name: 'quest_chain', arguments: ARGS.quest_chain });
    const text = (got.messages[0]!.content as { text: string }).text;
    expect(text).toContain('Elwynn Forest');
    expect(text.startsWith(PROMPT_RULES)).toBe(true);
  });

  it('offers none unless asked to', async () => {
    const { client } = await mcpFixture(allTools);
    await expect(client.listPrompts()).rejects.toThrow();
  });
});

describe('placing new things', () => {
  it('populate_place places new NPCs and objects through upsert_entity with spawn guids from allocate_ids, and add_spawn only for existing ones', () => {
    const text = allPrompts.find((p) => p.name === 'populate_place')!.text(ARGS.populate_place!);
    expect(text).toContain('`upsert_entity`');
    expect(text).toContain('`allocate_ids`');
    expect(text).toMatch(/add_spawn.{0,120}existing|existing.{0,120}add_spawn/s);
  });

  it('legendary_item places the guardian, and makes it hostile', () => {
    const text = allPrompts.find((p) => p.name === 'legendary_item')!.text(ARGS.legendary_item!);
    expect(text).toContain('`upsert_entity`');
    expect(text).toMatch(/hostile/i);
    expect(text.indexOf('`upsert_entity`')).toBeGreaterThan(text.indexOf('`new_entity`'));
  });

  it('quest_chain says how to add new NPCs too', () => {
    const text = allPrompts.find((p) => p.name === 'quest_chain')!.text(ARGS.quest_chain!);
    expect(text).toContain('`new_entity`');
    expect(text).toContain('`upsert_entity`');
  });
});
