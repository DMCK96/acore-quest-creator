// @ts-nocheck
/**
 * What an NPC's or object's display looks like: which model to draw, which skins fill its replaceable
 * texture slots, and which of its geosets show. Read from the game client's own tables (through the
 * scene's DbManager), so a client's custom displays draw too. A display that cannot be drawn resolves
 * to null and its spawn is drawn as a marker.
 */
import { ClientDb } from '@wowserhq/format';
import { CreatureDisplayInfoRecord, CreatureModelDataRecord, GameObjectDisplayInfoRecord } from '../db/records.js';

/** The client's tables by name (without `.dbc`); a table the client cannot give resolves to null */
type DisplayTables = { get(name: string): Promise<ClientDb<any> | null> };

type ModelLook = {
  kind: 'model';
  path: string;
  /** Replaceable texture slot → file */
  textures: Record<number, string>;
  /** Geoset ids to show; null shows them all */
  geosets: number[] | null;
  scale: number;
};

type BuildingLook = { kind: 'building'; path: string; scale: number };

type Look = ModelLook | BuildingLook;

/** The replaceable slot a display's first skin fills; the next two fill the slots after it */
const FIRST_SKIN_SLOT = 11;

/** A model file as the client stores it: `.mdx` and `.mdl` names are read as `.m2` */
const modelPath = (name: string) => name.replace(/\.(mdx|mdl)$/i, '.m2');

/** The folder part of a client path, without its trailing backslash */
const folderOf = (path: string) => {
  const cut = path.lastIndexOf('\\');
  return cut < 0 ? '' : path.slice(0, cut);
};

class DisplayResolver {
  #tables: DisplayTables;
  #loading = new globalThis.Map<string, Promise<ClientDb<any> | null>>();
  #warned = new Set<string>();

  constructor(tables: DisplayTables) {
    this.#tables = tables;
  }

  async creature(displayId: number): Promise<Look | null> {
    if (!(displayId > 0)) {
      return null;
    }

    const display = (await this.#table('CreatureDisplayInfo'))?.getRecord(displayId);
    if (!display) {
      return null;
    }

    const model = (await this.#table('CreatureModelData'))?.getRecord(display.modelId);
    if (!model || !model.modelName) {
      return null;
    }

    const path = modelPath(model.modelName);
    const folder = folderOf(model.modelName);
    const textures: Record<number, string> = {};
    display.textureVariations.forEach((skin, i) => {
      if (skin) {
        textures[FIRST_SKIN_SLOT + i] = `${folder}\\${skin}.blp`;
      }
    });

    const scale = Number.isFinite(display.creatureModelScale) && display.creatureModelScale > 0 ? display.creatureModelScale : 1;
    return { kind: 'model', path, textures, geosets: null, scale };
  }

  async object(displayId: number): Promise<Look | null> {
    const display = (await this.#table('GameObjectDisplayInfo'))?.getRecord(displayId);
    if (!display || !display.modelName) {
      return null;
    }

    if (/\.wmo$/i.test(display.modelName)) {
      return { kind: 'building', path: display.modelName, scale: 1 };
    }
    return { kind: 'model', path: modelPath(display.modelName), textures: {}, geosets: null, scale: 1 };
  }

  /** A table, loaded once; one that cannot be read is null, logged once */
  #table(name: string) {
    let loading = this.#loading.get(name);
    if (!loading) {
      loading = this.#tables.get(name).catch((error) => {
        this.#warnOnce(name, `3D view: ${name}.dbc could not be read: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      });
      this.#loading.set(name, loading);
    }
    return loading;
  }

  #warnOnce(key: string, message: string) {
    if (!this.#warned.has(key)) {
      this.#warned.add(key);
      console.warn(message);
    }
  }
}

export default DisplayResolver;
export { DisplayResolver, modelPath };
export type { BuildingLook, DisplayTables, Look, ModelLook };
