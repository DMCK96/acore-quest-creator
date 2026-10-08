// @ts-nocheck
import { openStream } from '@wowserhq/io';
import { DB_LOCALE, type ClientDbRecord } from '@wowserhq/format';

/** What the 3D view asks of a client table: the whole-table `ClientDb` and `LazyClientDb` both answer it */
interface ClientTable<T = any> {
  getRecord(id: number): T | null | undefined;
  getRecordByIndex(index: number): T | null | undefined;
  readonly records: T[];
}

interface Constructor<T> {
  new (...args: any[]): T;
}

const HEADER_SIZE = 20;
const MAGIC = 0x43424457; // 'WDBC' read as a little-endian uint32

/**
 * A client table that is read a row at a time, as `getRecord` asks for them. `ClientDb` makes a record of every
 * row when the file arrives, which for the item tables (half a million rows) blocks the page for a second or
 * more; the 3D view looks a few hundred of them up. The same interface: `getRecord`, `getRecordByIndex`, and
 * `records` (which does read them all).
 */
class LazyClientDb<T extends ClientDbRecord> {
  #Record: Constructor<T>;
  #locale: number;
  #stream = null;
  #stringBlock = null;
  #count = 0;
  #recordSize = 0;
  #ids = new Int32Array(0);
  /** Whether the ids ascend, so a row is found by halving, with no map built */
  #ascending = true;
  #rowOfId: Map<number, number> | null = null;
  #cache = new Map<number, T>();
  #all: T[] | null = null;

  constructor(RecordClass: Constructor<T>, locale = DB_LOCALE.LOCALE_ENUS) {
    this.#Record = RecordClass;
    this.#locale = locale;
  }

  load(source: Uint8Array | ArrayBuffer): this {
    const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < HEADER_SIZE || view.getUint32(0, true) !== MAGIC) throw new Error('not a WDBC client table');
    this.#count = view.getUint32(4, true);
    this.#recordSize = view.getUint32(12, true);
    const stringBlockSize = view.getUint32(16, true);
    const recordsEnd = HEADER_SIZE + this.#count * this.#recordSize;
    this.#stream = openStream(bytes);
    this.#stringBlock = openStream(bytes.slice(recordsEnd, recordsEnd + stringBlockSize));

    // The id is every row's first field
    this.#ids = new Int32Array(this.#count);
    for (let row = 0; row < this.#count; row++) {
      const id = view.getInt32(HEADER_SIZE + row * this.#recordSize, true);
      this.#ids[row] = id;
      if (row > 0 && id <= this.#ids[row - 1]!) this.#ascending = false;
    }
    return this;
  }

  #rowOf(id: number): number {
    if (this.#ascending) {
      let [lo, hi] = [0, this.#count - 1];
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const at = this.#ids[mid]!;
        if (at === id) return mid;
        if (at < id) lo = mid + 1;
        else hi = mid - 1;
      }
      return -1;
    }
    if (!this.#rowOfId) {
      this.#rowOfId = new Map();
      for (let row = 0; row < this.#count; row++) this.#rowOfId.set(this.#ids[row]!, row);
    }
    return this.#rowOfId.get(id) ?? -1;
  }

  getRecordByIndex(row: number): T | null {
    if (row < 0 || row >= this.#count) return null;
    let record = this.#cache.get(row);
    if (!record) {
      this.#stream.offset = HEADER_SIZE + row * this.#recordSize;
      record = new this.#Record().load(this.#stream, this.#stringBlock, this.#locale);
      this.#cache.set(row, record);
    }
    return record;
  }

  getRecord(id: number): T | null {
    const row = this.#rowOf(id);
    return row < 0 ? null : this.getRecordByIndex(row);
  }

  /** Every record, read now if they were not already */
  get records(): T[] {
    this.#all ??= Array.from({ length: this.#count }, (_, row) => this.getRecordByIndex(row)!);
    return this.#all;
  }
}

export default LazyClientDb;
export { LazyClientDb };
export type { ClientTable };
