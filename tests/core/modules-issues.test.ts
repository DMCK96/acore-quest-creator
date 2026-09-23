import { describe, it, expect } from 'vitest';
import { routeIssues, worstSeverity } from '@core/modules/issues';
import type { Issue } from '@core/validate/validate';

const issue = (fieldId: string | undefined, severity: Issue['severity'] = 'warning'): Issue =>
  ({ severity, code: 'X', fieldId, message: `m ${fieldId}` });

describe('issue routing', () => {
  it('sends each issue to the module owning its field', () => {
    const r = routeIssues([issue('creature_questender'), issue('quest_template.RewardItems', 'error'), issue('quest_template_addon.PrevQuestID')]);
    expect(r.byModule.giver).toHaveLength(1);
    expect(r.byModule.rewards?.[0].severity).toBe('error');
    expect(r.byModule.chain).toHaveLength(1);
    expect(r.header).toEqual([]);
  });
  it('sends header fields, unowned fields and field-less issues to the header', () => {
    const r = routeIssues([issue('quest_template.LogTitle'), issue(undefined), issue('no.such')]);
    expect(r.header).toHaveLength(3);
  });
  it('picks the worst severity', () => {
    expect(worstSeverity([issue('a'), issue('b', 'error')])).toBe('error');
    expect(worstSeverity([issue('a')])).toBe('warning');
    expect(worstSeverity([])).toBeNull();
    expect(worstSeverity(undefined)).toBeNull();
  });
});
