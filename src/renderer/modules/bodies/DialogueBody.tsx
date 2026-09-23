import { LocaleNotice } from '../../components/LocaleNotice';
import type { ModuleBodyProps } from '../body-props';
import { FieldSetting } from '../FieldSetting';

const TEXTS: ReadonlyArray<readonly [string, string]> = [
  ['quest_template.QuestDescription', 'Offer text'],
  ['quest_details.Emotes', 'Emotes while offering'],
  ['quest_request_items.CompletionText', 'Progress text'],
  ['quest_request_items.EmoteOnIncomplete', 'Emote while unfinished'],
  ['quest_request_items.EmoteOnComplete', 'Emote when finished'],
  ['quest_offer_reward.RewardText', 'Turn-in text'],
  ['quest_offer_reward.Emotes', 'Emotes at turn-in'],
  ['quest_template.QuestCompletionLog', 'Completion log line'],
];

/** What the quest giver says at each step, each text next to the emote played with it. */
export function DialogueBody({ open, onChange }: ModuleBodyProps): React.JSX.Element {
  return (
    <div>
      <LocaleNotice open={open} group="story" />
      {TEXTS.map(([fieldId, label]) => (
        <FieldSetting key={fieldId} fieldId={fieldId} label={label} aggregate={open.aggregate} onChange={onChange} />
      ))}
    </div>
  );
}
