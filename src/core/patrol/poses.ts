/**
 * Poses a patrolling NPC can hold while it waits at a point: `EMOTE_STATE_*` values from the fork's
 * `SharedDefines.h`, named in our own words.
 */
export const POSES: readonly { value: number; label: string }[] = [
  { value: 13, label: 'Sit' },
  { value: 68, label: 'Kneel' },
  { value: 12, label: 'Sleep' },
  { value: 65, label: 'Play dead' },
  { value: 415, label: 'Sit in a chair' },
  { value: 173, label: 'Work' },
  { value: 233, label: 'Mining' },
  { value: 234, label: 'Chopping wood' },
  { value: 379, label: 'Fishing' },
  { value: 69, label: 'Use (standing)' },
  { value: 418, label: 'Eat' },
  { value: 378, label: 'Talk' },
  { value: 431, label: 'Cower' },
  { value: 29, label: 'Point' },
];
