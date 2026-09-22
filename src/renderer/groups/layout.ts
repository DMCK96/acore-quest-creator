import type { EditorGroup } from '@core/registry/types';

/**
 * Explicit field-id order per editor group, read by `GroupPanel`. A field of the group that is not
 * listed here simply follows, in registry order, after the ones that are.
 */
export const GROUP_LAYOUT: Record<EditorGroup, readonly string[]> = {
  identity: [
    'quest_template.ID',
    'quest_template.QuestLevel',
    'quest_template.MinLevel',
    'quest_template_addon.MaxLevel',
    'quest_template.QuestSortID',
    'quest_template.QuestType',
    'quest_template.QuestInfoID',
    'quest_template.SuggestedGroupNum',
    'quest_template.AllowableRaces',
    'quest_template_addon.AllowableClasses',
  ],
  story: [
    'quest_template.LogTitle',
    'quest_template.QuestDescription',
    'quest_template.LogDescription',
    'quest_request_items.CompletionText',
    'quest_offer_reward.RewardText',
    'quest_template.QuestCompletionLog',
    'quest_details.Emotes',
    'quest_offer_reward.Emotes',
    'quest_request_items.EmoteOnComplete',
    'quest_request_items.EmoteOnIncomplete',
  ],
  objectives: [
    'quest_template.RequiredNpcOrGo',
    'quest_template.RequiredItems',
    'quest_template.ObjectiveText',
    'quest_template.RequiredPlayerKills',
    'quest_template.TimeAllowed',
    'quest_template.ItemDrops',
  ],
  rewards: [
    'quest_template.RewardXPDifficulty',
    'quest_template.RewardMoney',
    'quest_template.RewardMoneyDifficulty',
    'quest_template.RewardItems',
    'quest_template.RewardChoiceItems',
    'quest_template.RewardFactions',
    'quest_template.RewardHonor',
    'quest_template.RewardKillHonor',
    'quest_template.RewardSpell',
    'quest_template.RewardDisplaySpell',
    'quest_template.RewardTitle',
    'quest_template.RewardTalents',
    'quest_template.RewardArenaPoints',
    'quest_mail_sender.RewardMailSenderEntry',
    'quest_template_addon.RewardMailTemplateID',
    'quest_template_addon.RewardMailDelay',
  ],
  availability: [],
  map: [],
};
