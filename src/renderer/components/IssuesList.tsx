import type { Issue } from '@core/validate/validate';

export function IssuesList({ issues }: { issues: Issue[] }): React.JSX.Element {
  const ordered = [...issues].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
  return (
    <ul>
      {ordered.map((issue, i) => (
        <li key={i} data-severity={issue.severity}>
          {issue.message}
        </li>
      ))}
    </ul>
  );
}
