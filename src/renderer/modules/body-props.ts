import type { FieldValue } from '@core/registry/types';
import type { OpenResult, QuestLinks } from '@shared/ipc';

/** What every module body is given: the open quest, its links, and a way to change a field. */
export interface ModuleBodyProps {
  open: OpenResult;
  links: QuestLinks | null;
  onChange(fieldId: string, value: FieldValue): void;
  /** Switches the editor to another quest, e.g. the owner of a link. */
  onOpenQuest(id: number): void;
}

export type ModuleBodyComponent = (props: ModuleBodyProps) => React.JSX.Element;
