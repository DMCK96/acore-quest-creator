/** Cells a grid may have at most, whatever the floor's size */
const MAX_CELLS = 512 * 512;
/** Triangles a cell holds, about, when the floor is spread evenly */
const PER_CELL = 4;
const EDGE = 1e-9;

/**
 * The triangles of one mesh by where they lie from above, for finding the floor under a point without testing
 * every triangle (three.js tests them all: some of a city's buildings have a few hundred thousand). A vertical
 * ray only meets the triangles of the cell it falls in. Heights are in the mesh's own space.
 */
export class FloorGrid {
  #positions: ArrayLike<number>;
  #indices: ArrayLike<number> | null;
  #minX = 0;
  #minY = 0;
  #cell = 1;
  #columns = 1;
  #rows = 1;
  /** Where each cell's triangles start in `#triangles`; a cell ends where the next begins */
  #starts: Uint32Array;
  #triangles: Uint32Array;

  constructor(positions: ArrayLike<number>, indices: ArrayLike<number> | null) {
    this.#positions = positions;
    this.#indices = indices;
    const count = Math.floor((indices ? indices.length : positions.length / 3) / 3);

    let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 3) {
      minX = Math.min(minX, positions[i]!);
      maxX = Math.max(maxX, positions[i]!);
      minY = Math.min(minY, positions[i + 1]!);
      maxY = Math.max(maxY, positions[i + 1]!);
    }
    if (count === 0 || !Number.isFinite(minX)) {
      this.#starts = new Uint32Array(2);
      this.#triangles = new Uint32Array(0);
      return;
    }
    const width = Math.max(maxX - minX, 1e-3);
    const height = Math.max(maxY - minY, 1e-3);
    let cell = Math.sqrt((width * height * PER_CELL) / count);
    cell = Math.max(cell, Math.sqrt((width * height) / MAX_CELLS), 1e-3);
    this.#minX = minX;
    this.#minY = minY;
    this.#cell = cell;
    this.#columns = Math.max(1, Math.ceil(width / cell));
    this.#rows = Math.max(1, Math.ceil(height / cell));

    // Two passes: how many each cell holds, then where they go
    const cells = this.#columns * this.#rows;
    const counts = new Uint32Array(cells + 1);
    const each = (visit: (triangle: number, c0: number, c1: number, r0: number, r1: number) => void) => {
      for (let t = 0; t < count; t++) {
        const [ax, ay, bx, by, cx, cy] = this.#xy(t);
        // A wall, seen from above, is a line: a vertical ray never meets it
        if (Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) < EDGE) continue;
        visit(
          t,
          this.#column(Math.min(ax, bx, cx)), this.#column(Math.max(ax, bx, cx)),
          this.#row(Math.min(ay, by, cy)), this.#row(Math.max(ay, by, cy)),
        );
      }
    };
    each((_t, c0, c1, r0, r1) => {
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) counts[r * this.#columns + c + 1]!++;
    });
    for (let i = 0; i < cells; i++) counts[i + 1]! += counts[i]!;
    this.#starts = counts;
    this.#triangles = new Uint32Array(counts[cells]!);
    const filled = new Uint32Array(cells);
    each((t, c0, c1, r0, r1) => {
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const cellIndex = r * this.#columns + c;
          this.#triangles[this.#starts[cellIndex]! + filled[cellIndex]!++] = t;
        }
      }
    });
  }

  #corner(t: number, k: number): number {
    return this.#indices ? this.#indices[t * 3 + k]! : t * 3 + k;
  }

  #xy(t: number): [number, number, number, number, number, number] {
    const p = this.#positions;
    const [a, b, c] = [this.#corner(t, 0) * 3, this.#corner(t, 1) * 3, this.#corner(t, 2) * 3];
    return [p[a]!, p[a + 1]!, p[b]!, p[b + 1]!, p[c]!, p[c + 1]!];
  }

  #column(x: number): number {
    return Math.min(this.#columns - 1, Math.max(0, Math.floor((x - this.#minX) / this.#cell)));
  }

  #row(y: number): number {
    return Math.min(this.#rows - 1, Math.max(0, Math.floor((y - this.#minY) / this.#cell)));
  }

  /**
   * The height of the highest triangle under (x, y) that is at most `fromZ` and no more than `distance` below
   * it; null when there is none. Unless `doubleSided`, a triangle only counts when it faces up (counter-clockwise
   * seen from above), as three.js treats a one-sided material.
   */
  highestBelow(x: number, y: number, fromZ: number, distance: number, doubleSided: boolean): number | null {
    if (this.#triangles.length === 0) return null;
    if (x < this.#minX - this.#cell || y < this.#minY - this.#cell) return null;
    const cell = this.#row(y) * this.#columns + this.#column(x);
    const p = this.#positions;
    let best: number | null = null;
    for (let i = this.#starts[cell]!; i < this.#starts[cell + 1]!; i++) {
      const t = this.#triangles[i]!;
      const [a, b, c] = [this.#corner(t, 0) * 3, this.#corner(t, 1) * 3, this.#corner(t, 2) * 3];
      const [ax, ay, az] = [p[a]!, p[a + 1]!, p[a + 2]!];
      const [bx, by, bz] = [p[b]!, p[b + 1]!, p[b + 2]!];
      const [cx, cy, cz] = [p[c]!, p[c + 1]!, p[c + 2]!];
      // Twice the triangle's area seen from above, signed: positive when it faces up
      const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
      if (area === 0 || (area < 0 && !doubleSided)) continue;
      // Barycentric weights of the point
      const u = ((bx - x) * (cy - y) - (cx - x) * (by - y)) / area;
      const v = ((cx - x) * (ay - y) - (ax - x) * (cy - y)) / area;
      const w = 1 - u - v;
      if (u < -EDGE || v < -EDGE || w < -EDGE) continue;
      const z = u * az + v * bz + w * cz;
      if (z > fromZ || z < fromZ - distance) continue;
      if (best === null || z > best) best = z;
    }
    return best;
  }
}
