import { describe, it, expect } from 'vitest';
import { importFixture, forkDb } from '../helpers/fixtures';
import { buildPatch } from '@core/export/build-patch';
import { verifyRoundTrip } from '@core/roundtrip/verify';
import { registry, fieldById } from '@core/registry';

describe('text tables', () => {
  it('registers the pinned ids in the story and rewards groups', () => {
    expect(fieldById('quest_offer_reward.RewardText')!.group).toBe('story');
    expect(fieldById('quest_request_items.CompletionText')!.group).toBe('story');
    expect((fieldById('quest_details.Emotes') as any).slots).toBe(4);
    expect(fieldById('quest_mail_sender.RewardMailSenderEntry')!.group).toBe('rewards');
  });

  it('imports and round-trips all four tables including emotes and mail sender', async () => {
    const db = forkDb();
    db.insert('quest_template', { ID: '60001', LogTitle: 'T' });
    db.insert('quest_details', { ID: '60001', Emote1: '1', EmoteDelay1: '500' });
    db.insert('quest_offer_reward', { ID: '60001', RewardText: 'Well done, $N.\r\nTake this.', Emote2: '5' });
    db.insert('quest_request_items', { ID: '60001', CompletionText: 'Got it?', EmoteOnIncomplete: '6' });
    db.insert('quest_mail_sender', { QuestId: '60001', RewardMailSenderEntry: '1234' });
    const { aggregate, snapshot, schema } = await importFixture(db, 60001);
    expect(aggregate.values['quest_details.Emotes']).toEqual([{ emote: 1, delay: 500 }]);
    expect(aggregate.values['quest_offer_reward.RewardText']).toBe('Well done, $N.\r\nTake this.');
    expect(aggregate.values['quest_mail_sender.RewardMailSenderEntry']).toBe(1234);
    expect(verifyRoundTrip({ aggregate, snapshot, schema, registry })).toEqual({ ok: true });
  });

  it('edits the offer-reward text and touches only that column', async () => {
    const db = forkDb();
    db.insert('quest_template', { ID: '60001' });
    db.insert('quest_offer_reward', { ID: '60001', RewardText: 'old', Emote2: '5' });
    const { aggregate, snapshot, schema } = await importFixture(db, 60001);
    const edited = { ...aggregate, values: { ...aggregate.values, 'quest_offer_reward.RewardText': 'new' } };
    const p = buildPatch({ aggregate: edited, snapshot, schema, registry });
    const row = (p.statements.find((s) => s.kind === 'insert' && s.table === 'quest_offer_reward') as any).row;
    expect(row).toMatchObject({ ID: '60001', RewardText: 'new', Emote2: '5' });
  });

  it('a new quest always gets offer-reward and request-items rows but no details or mail rows', async () => {
    const db = forkDb();
    db.insert('quest_template', { ID: '60001' });
    const { aggregate, schema } = await importFixture(db, 60001);
    const fresh = { ...aggregate, isNew: true, questId: 60010 };
    const tables = buildPatch({ aggregate: fresh, snapshot: null, schema, registry }).statements
      .filter((s) => s.kind === 'insert').map((s) => s.table);
    expect(tables).toContain('quest_offer_reward');
    expect(tables).toContain('quest_request_items');
    expect(tables).not.toContain('quest_details');
    expect(tables).not.toContain('quest_mail_sender');
  });
});
