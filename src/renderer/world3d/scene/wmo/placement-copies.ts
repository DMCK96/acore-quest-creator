import type * as THREE from 'three';

/**
 * A building that spans tiles is placed by every tile it touches, each placing the same building at the same
 * spot. The copies are all kept, one for each area, so an area owns what it loaded, but only one is drawn: the
 * first loaded. When its area goes another is drawn in its place.
 */
export class PlacementCopies {
  #copies = new Map<string, { areaId: number; object: THREE.Object3D }[]>();
  #keysByArea = new Map<number, string[]>();

  /** Takes a placed building: drawn when it is the first of its key, hidden otherwise */
  add(key: string, areaId: number, object: THREE.Object3D): void {
    const list = this.#copies.get(key) ?? [];
    list.push({ areaId, object });
    this.#copies.set(key, list);
    this.#keysByArea.set(areaId, [...(this.#keysByArea.get(areaId) ?? []), key]);
    object.visible = list.length === 1;
  }

  /** The area's buildings are gone: a building it had drawn is drawn from another area, if one has it */
  removeArea(areaId: number): void {
    for (const key of this.#keysByArea.get(areaId) ?? []) {
      const list = (this.#copies.get(key) ?? []).filter((copy) => copy.areaId !== areaId);
      if (list.length === 0) this.#copies.delete(key);
      else {
        this.#copies.set(key, list);
        list.forEach((copy, i) => (copy.object.visible = i === 0));
      }
    }
    this.#keysByArea.delete(areaId);
  }
}
