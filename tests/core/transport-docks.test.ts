import { describe, expect, it } from 'vitest';
import { NODE_STOP, type TaxiNode } from '../../src/core/game/taxi-path';
import { docksOn } from '../../src/core/map/transport-docks';
import { frameAt } from '../../src/core/map/transport-frame';
import type { WorldMap } from '../../src/core/map/world-maps';

const node = (index: number, map: number, x: number, y: number, flags = 0): TaxiNode => ({ index, map, x, y, z: 10, flags, delay: 0 });
const KALIMDOR = 1;
const EASTERN = 0;

// Durotar stop, flight over the sea, Tirisfal stop
const zeppelinPath = [node(0, KALIMDOR, 1000, -4000, NODE_STOP), node(1, KALIMDOR, 900, -3000), node(2, EASTERN, 2200, 200, NODE_STOP), node(3, EASTERN, 2250, 250)];
const second = [node(0, KALIMDOR, 5, 5, NODE_STOP)];

const transport = (id: number, templates: { entry: number; displayId: number; pathId: number }[], paths: Record<number, TaxiNode[]>): WorldMap =>
  ({ id, name: `T${id}`, directory: 'kalimdor', kind: 'transport', start: { x: 0, y: 0, z: 0 }, transport: { templates: templates.map((t) => ({ ...t, name: 'v' })), paths } }) as WorldMap;

const zeppelin = transport(591, [{ entry: 164871, displayId: 3031, pathId: 302 }, { entry: 2, displayId: 99, pathId: 303 }], { 302: zeppelinPath, 303: second });

describe('the docks on a continent', () => {
  it('lists the stops on that continent, framed as the transport view frames them', () => {
    const [dock] = docksOn([zeppelin], KALIMDOR);
    expect(dock).toEqual({ key: '591:0', map: 591, template: 164871, node: 0, displayId: 3031, frame: frameAt(zeppelinPath, 0) });
  });

  it('lists the other continent’s stop for that continent', () => {
    expect(docksOn([zeppelin], EASTERN).map((d) => d.key)).toEqual(['591:2']);
  });

  it('leaves out nodes that are not stops, and nodes on other maps', () => {
    expect(docksOn([zeppelin], KALIMDOR).map((d) => d.node)).toEqual([0]);
  });

  it('uses the first template only', () => {
    expect(docksOn([zeppelin], KALIMDOR).every((d) => d.template === 164871)).toBe(true);
  });

  it('lists two stops of one route on the same continent', () => {
    const twice = transport(5, [{ entry: 7, displayId: 1, pathId: 9 }], { 9: [node(0, KALIMDOR, 1, 1, NODE_STOP), node(1, KALIMDOR, 50, 50), node(2, KALIMDOR, 90, 90, NODE_STOP)] });
    expect(docksOn([twice], KALIMDOR).map((d) => d.key)).toEqual(['5:0', '5:2']);
  });

  it('leaves out every dock of the map the transport view shows: its passengers are drawn there already', () => {
    expect(docksOn([zeppelin], KALIMDOR, 591)).toEqual([]);
    expect(docksOn([zeppelin], EASTERN, 591)).toEqual([]);
    const ferry = transport(5, [{ entry: 7, displayId: 1, pathId: 9 }], { 9: [node(0, KALIMDOR, 1, 1, NODE_STOP), node(1, KALIMDOR, 90, 90, NODE_STOP)] });
    expect(docksOn([zeppelin, ferry], KALIMDOR, 591).map((d) => d.key)).toEqual(['5:0', '5:1']);
  });

  it('ignores maps that are not transports, and a transport with no templates or no path', () => {
    const plain = { id: 1, name: 'Kalimdor', directory: 'kalimdor', kind: 'continent', start: { x: 0, y: 0, z: 0 } } as WorldMap;
    const empty = transport(6, [], {});
    const lost = transport(7, [{ entry: 1, displayId: 1, pathId: 404 }], {});
    expect(docksOn([plain, empty, lost], KALIMDOR)).toEqual([]);
  });

  it('is empty for a continent nothing stops at', () => {
    expect(docksOn([zeppelin], 530)).toEqual([]);
  });
});
