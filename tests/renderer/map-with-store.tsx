import type { ComponentProps } from 'react';
import { ENTITIES_FIELD, readEntities, writeEntities, type ProjectEntities } from '../../src/core/entities/model';
import { QuestMapView } from '../../src/renderer/map/QuestMapView';
import { ProjectEntitiesProvider } from '../../src/renderer/state/project-entities';

/**
 * The quest map over a project store seeded from the quest's old `entities` field, its changes reported
 * as `onChange(ENTITIES_FIELD, next)`: the map tests written before the project store keep stating
 * their NPCs and reading their edits as they did.
 */
export function MapWithStore(props: ComponentProps<typeof QuestMapView>): React.JSX.Element {
  const { open, onChange } = props;
  const entities = readEntities(open.aggregate.values);
  const value = { entities, setEntities: (next: ProjectEntities) => onChange(ENTITIES_FIELD, writeEntities(next)), quests: [], create: async () => ({ error: 'not here' }), remove: async () => null };
  return (
    <ProjectEntitiesProvider value={value}>
      <QuestMapView {...props} />
    </ProjectEntitiesProvider>
  );
}

/** A provider value over a fixed store, its changes going to `setEntities` */
export function storeOf(entities: ProjectEntities, setEntities: (next: ProjectEntities) => void = () => {}) {
  return { entities, setEntities, quests: [], create: async () => ({ error: 'not here' }), remove: async () => null };
}
