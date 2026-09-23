import type { Issue } from '../validate/validate';
import { ownerOf } from './catalog';
import type { ModuleId } from './model';

/** Issues grouped by the module whose field they concern; the rest belong to the quest header. */
export function routeIssues(issues: readonly Issue[]): { byModule: Partial<Record<ModuleId, Issue[]>>; header: Issue[] } {
  const byModule: Partial<Record<ModuleId, Issue[]>> = {};
  const header: Issue[] = [];
  for (const issue of issues) {
    const owner = issue.fieldId === undefined ? undefined : ownerOf(issue.fieldId);
    if (owner === undefined || owner === 'header' || owner === 'hidden') header.push(issue);
    else (byModule[owner] ??= []).push(issue);
  }
  return { byModule, header };
}

export function worstSeverity(issues: readonly Issue[] | undefined): 'error' | 'warning' | null {
  if (!issues || issues.length === 0) return null;
  return issues.some((i) => i.severity === 'error') ? 'error' : 'warning';
}
