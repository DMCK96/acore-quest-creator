import { describe, expect, it } from 'vitest';
import { GOSSIP_SERVICES, serviceLabel, serviceOf } from '../../src/core/game/gossip-services';

describe('gossip services', () => {
  it('names the twelve services by the type and flag pair the database uses', () => {
    expect(GOSSIP_SERVICES).toHaveLength(12);
    expect(serviceOf(3, 128)).toMatchObject({ id: 'vendor', label: 'Vendor', icon: 1 });
    expect(serviceOf(5, 16)).toMatchObject({ id: 'trainer', icon: 3 });
    expect(serviceOf(8, 65536)).toMatchObject({ id: 'inn' });
    expect(serviceOf(16, 16)).toMatchObject({ id: 'unlearn' });
  });
  it('has no service for a pair it does not know, and labels it as other', () => {
    expect(serviceOf(3, 1)).toBeUndefined();
    expect(serviceLabel(20, 1)).toBe('Other (type 20, flag 1)');
    expect(serviceLabel(3, 128)).toBe('Vendor');
  });
  it('gives each service a distinct pair', () => {
    expect(new Set(GOSSIP_SERVICES.map((s) => `${s.type}/${s.npcFlag}`)).size).toBe(12);
  });
});
