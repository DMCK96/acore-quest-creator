import type { ProjectEntities } from '../../src/core/entities/model';

/** A store with every entity made for `questId`, so that quest uses them all */
export function madeFor(entities: ProjectEntities, questId: number): ProjectEntities {
  return {
    npcs: entities.npcs.map((e) => ({ ...e, madeFor: questId })),
    objects: entities.objects.map((e) => ({ ...e, madeFor: questId })),
    items: entities.items.map((e) => ({ ...e, madeFor: questId })),
  };
}
