import { describe, expect, it } from 'vitest';
import { waypointSettings, withWaypointSettings } from '../../../src/core/world/waypoint-point';

/** A database route point's other columns, as the world layer keeps them */
const rest = { delay: '2500', move_type: '1', orientation: null, action: '7', action_chance: '100', wpguid: '0' };

describe('a database route point\'s settings', () => {
  it('are read from its waypoint_data columns: the wait in seconds, its move type, facing and script', () => {
    expect(waypointSettings(rest)).toEqual({ waitSecs: 2.5, moveType: 1, facing: null, script: 7 });
    expect(waypointSettings({ ...rest, orientation: '1.5' }).facing).toBe(1.5);
  });

  it('read a column a fork lacks, or garbage, as nothing', () => {
    expect(waypointSettings({})).toEqual({ waitSecs: 0, moveType: 0, facing: null, script: 0 });
    expect(waypointSettings({ delay: 'x', move_type: '', orientation: 'nope' })).toEqual({ waitSecs: 0, moveType: 0, facing: null, script: 0 });
  });

  it('are written back over those columns, keeping every other one as it was', () => {
    const next = withWaypointSettings(rest, { waitSecs: 4, moveType: 0, facing: 3.14159, script: 99 });
    expect(next).toEqual({ ...rest, delay: '4000', move_type: '0', orientation: '3.14159' });
  });

  it('write no facing as NULL, and a wait to the millisecond', () => {
    const next = withWaypointSettings({ ...rest, orientation: '1' }, { waitSecs: 1.2345, moveType: 1, facing: null, script: 7 });
    expect(next.orientation).toBeNull();
    expect(next.delay).toBe('1235');
  });

  it('leave a column a fork lacks out, rather than adding it', () => {
    expect(withWaypointSettings({ delay: '0' }, { waitSecs: 1, moveType: 1, facing: 2, script: 0 })).toEqual({ delay: '1000' });
  });
});
