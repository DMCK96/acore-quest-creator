import * as THREE from 'three';

/**
 * Whether the camera's view changed since the last check: where it is and what it sees (its frustum),
 * or something marked as changing what a cull would decide (an area loaded or dropped). A cull whose
 * answer depends only on these can be skipped while the camera stands still.
 */
export class ViewChange {
  #position = new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN);
  #planes = new Float64Array(24);
  #marked = true;

  /** Something other than the camera changed what the next cull decides */
  mark(): void {
    this.#marked = true;
  }

  /** True when the view changed since the last check (or was marked), and remembers this one */
  check(position: THREE.Vector3, frustum: THREE.Frustum): boolean {
    let changed = this.#marked || !position.equals(this.#position);
    for (let i = 0; i < 6; i++) {
      const plane = frustum.planes[i]!;
      const at = i * 4;
      if (
        plane.normal.x !== this.#planes[at] ||
        plane.normal.y !== this.#planes[at + 1] ||
        plane.normal.z !== this.#planes[at + 2] ||
        plane.constant !== this.#planes[at + 3]
      ) {
        changed = true;
        this.#planes[at] = plane.normal.x;
        this.#planes[at + 1] = plane.normal.y;
        this.#planes[at + 2] = plane.normal.z;
        this.#planes[at + 3] = plane.constant;
      }
    }
    this.#position.copy(position);
    this.#marked = false;
    return changed;
  }
}
