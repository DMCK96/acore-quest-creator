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

/**
 * A humanoid's body as it shows bare: the body (0), default facial geosets (101, 201, 301), bare
 * hands (401), feet (501), ears (702) and legs (1301). Its hair and beard replace some of these.
 */
const DEFAULT_CHARACTER_GEOSETS = [0, 101, 201, 301, 401, 501, 702, 1301];

/** Replaceable slots a humanoid fills: its baked body texture, and its hair */
const BODY_SLOT = 1;
const HAIR_SLOT = 6;
/** CharSections' base section for hair */
const HAIR_SECTION = 3;

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
  #indexes = new globalThis.Map<string, Promise<globalThis.Map<string, any>>>();

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

    return display.extendedDisplayInfoId > 0 ? this.#humanoid(display) : this.#plain(display);
  }

  /** A creature that is its own model, in up to three skins */
  async #plain(display) {
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

  /**
   * A humanoid NPC: its race's body, in its baked skin-and-clothes texture and its hair texture, with
   * the geosets of its hairstyle and beard showing instead of every one the body carries
   */
  async #humanoid(display) {
    const extra = (await this.#table('CreatureDisplayInfoExtra'))?.getRecord(display.extendedDisplayInfoId);
    const race = extra ? (await this.#table('ChrRaces'))?.getRecord(extra.race) : null;
    const bodyId = race ? (extra.sex === 0 ? race.maleDisplayId : race.femaleDisplayId) : 0;
    const bodyDisplay = bodyId > 0 ? (await this.#table('CreatureDisplayInfo'))?.getRecord(bodyId) : null;
    const body = bodyDisplay ? await this.#plain(bodyDisplay) : null;
    if (!body) {
      return null;
    }

    const textures: Record<number, string> = {};
    if (extra.bakeName) {
      textures[BODY_SLOT] = `Textures\\BakedNpcTextures\\${extra.bakeName}`;
    }
    const hairSection = (await this.#index('CharSections', (r) => r.baseSection === HAIR_SECTION ? `${r.race}:${r.sex}:${r.variation}:${r.colour}` : null))
      .get(`${extra.race}:${extra.sex}:${extra.hairStyle}:${extra.hairColour}`);
    if (hairSection?.textures[0]) {
      textures[HAIR_SLOT] = hairSection.textures[0];
    }

    const geosets = new Set(DEFAULT_CHARACTER_GEOSETS);
    const hair = (await this.#index('CharHairGeosets', (r) => `${r.race}:${r.sex}:${r.variation}`)).get(`${extra.race}:${extra.sex}:${extra.hairStyle}`);
    if (hair && hair.geoset > 0) {
      geosets.add(hair.geoset);
    }
    const beard = (await this.#index('CharacterFacialHairStyles', (r) => `${r.race}:${r.sex}:${r.variation}`)).get(`${extra.race}:${extra.sex}:${extra.facialHair}`);
    if (beard) {
      [100, 200, 300].forEach((group, i) => {
        if (beard.geosets[i] > 0) {
          geosets.delete(group + 1);
          geosets.add(group + beard.geosets[i]);
        }
      });
    }

    const scale = Number.isFinite(display.creatureModelScale) && display.creatureModelScale > 0 ? display.creatureModelScale : 1;
    return { kind: 'model', path: body.path, textures, geosets: [...geosets].sort((a, b) => a - b), scale };
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

  /** A table's records by a key, built once; a table that cannot be read gives an empty index */
  #index(name: string, keyOf: (record: any) => string | null) {
    let index = this.#indexes.get(name);
    if (!index) {
      index = this.#table(name).then((db) => {
        const byKey = new globalThis.Map<string, any>();
        for (const record of db?.records ?? []) {
          const key = keyOf(record);
          if (key !== null && !byKey.has(key)) byKey.set(key, record);
        }
        return byKey;
      });
      this.#indexes.set(name, index);
    }
    return index;
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
export { DEFAULT_CHARACTER_GEOSETS, DisplayResolver, modelPath };
export type { BuildingLook, DisplayTables, Look, ModelLook };
