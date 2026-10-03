// @ts-nocheck
/**
 * What an NPC's or object's display looks like: which model to draw, which skins fill its replaceable
 * texture slots, and which of its geosets show. Read from the game client's own tables (through the
 * scene's DbManager), so a client's custom displays draw too. A display that cannot be drawn resolves
 * to null and its spawn is drawn as a marker.
 */
import { ClientDb } from '@wowserhq/format';
import { CreatureDisplayInfoRecord, CreatureModelDataRecord, GameObjectDisplayInfoRecord } from '../db/records.js';
import { ViewPreset } from '../../../../core/db/view-spawns.js';

/** How a humanoid looks: a CreatureDisplayInfoExtra row, or a display preset (with no baked texture) */
type Appearance = { race: number; sex: number; skin: number; hairStyle: number; hairColour: number; facialHair: number; bakeName: string };

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
  /** A held item that goes on the arm (attachment 0), not in the hand */
  shield?: boolean;
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
/** CharSections' base sections: a race's skin (by colour), and its hair */
const SKIN_SECTION = 0;
const HAIR_SECTION = 3;

/** Where weapon models live, and the replaceable slot (object skin) their texture fills */
const WEAPON_FOLDER = 'Item\\ObjectComponents\\Weapon';
const SHIELD_FOLDER = 'Item\\ObjectComponents\\Shield';
const WEAPON_SKIN_SLOT = 2;
/** Item.dbc inventory type of a shield */
const SHIELD_INVENTORY_TYPE = 14;

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
  #bodies: Promise<globalThis.Map<number, { race: number; sex: number }>> | null = null;

  constructor(tables: DisplayTables) {
    this.#tables = tables;
  }

  /**
   * A creature's look by its display, or by the display preset that dresses it (the preset's race
   * and look, whatever the display is, as the server sends it)
   */
  async creature(displayId: number, preset: ViewPreset | null = null): Promise<Look | null> {
    const display = displayId > 0 ? (await this.#table('CreatureDisplayInfo'))?.getRecord(displayId) : null;
    const scale = display && Number.isFinite(display.creatureModelScale) && display.creatureModelScale > 0 ? display.creatureModelScale : 1;
    if (preset) {
      return this.#character({ race: preset.race, sex: preset.sex, skin: preset.skin, hairStyle: preset.hairStyle, hairColour: preset.hairColour, facialHair: preset.facialHair, bakeName: '' }, scale);
    }
    if (!display) {
      return null;
    }
    if (display.extendedDisplayInfoId > 0) {
      const extra = (await this.#table('CreatureDisplayInfoExtra'))?.getRecord(display.extendedDisplayInfoId);
      return extra ? this.#character(extra, scale) : null;
    }
    return this.#plain(display);
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

    // A race's own body with nothing to dress it (as `.morph 49` shows): the bare body in its default
    // skin. Left empty, the body's skin slot draws black
    const body = (await this.#raceBodies()).get(display.modelId);
    if (body && !textures[BODY_SLOT]) {
      const skin = await this.#skin(body.race, body.sex, 0);
      if (skin) textures[BODY_SLOT] = skin;
    }

    const scale = Number.isFinite(display.creatureModelScale) && display.creatureModelScale > 0 ? display.creatureModelScale : 1;
    return { kind: 'model', path, textures, geosets: null, scale };
  }

  /** Which race and sex each race body model is, by model id, from the races' body displays */
  #raceBodies() {
    this.#bodies ??= (async () => {
      const bodies = new globalThis.Map<number, { race: number; sex: number }>();
      const displays = await this.#table('CreatureDisplayInfo');
      for (const race of (await this.#table('ChrRaces'))?.records ?? []) {
        [race.maleDisplayId, race.femaleDisplayId].forEach((displayId, sex) => {
          const modelId = displayId > 0 ? displays?.getRecord(displayId)?.modelId : undefined;
          if (modelId && !bodies.has(modelId)) bodies.set(modelId, { race: race.id, sex });
        });
      }
      return bodies;
    })();
    return this.#bodies;
  }

  /** A race's body skin in one of its colours, from CharSections; null when the client has none */
  async #skin(race: number, sex: number, colour: number): Promise<string | null> {
    const skins = await this.#index('CharSections', (r) => (r.baseSection === SKIN_SECTION ? `${r.race}:${r.sex}:${r.variation}:${r.colour}` : null), 'CharSections:skin');
    return skins.get(`${race}:${sex}:0:${colour}`)?.textures[0] || null;
  }

  /**
   * A humanoid NPC: its race's body, in its baked skin-and-clothes texture (or its bare skin colour
   * without one) and its hair texture, with the geosets of its hairstyle and beard showing instead of
   * every one the body carries
   */
  async #character(look: Appearance, scale: number) {
    const race = (await this.#table('ChrRaces'))?.getRecord(look.race);
    const bodyId = race ? (look.sex === 0 ? race.maleDisplayId : race.femaleDisplayId) : 0;
    const bodyDisplay = bodyId > 0 ? (await this.#table('CreatureDisplayInfo'))?.getRecord(bodyId) : null;
    const body = bodyDisplay ? await this.#plain(bodyDisplay) : null;
    if (!body) {
      return null;
    }

    const textures: Record<number, string> = {};
    if (look.bakeName) {
      textures[BODY_SLOT] = `Textures\\BakedNpcTextures\\${look.bakeName}`;
    } else {
      // No baked texture: its skin colour at least, rather than a body drawn black
      const skin = await this.#skin(look.race, look.sex, look.skin);
      if (skin) textures[BODY_SLOT] = skin;
    }
    const hairSection = (await this.#index('CharSections', (r) => r.baseSection === HAIR_SECTION ? `${r.race}:${r.sex}:${r.variation}:${r.colour}` : null, 'CharSections:hair'))
      .get(`${look.race}:${look.sex}:${look.hairStyle}:${look.hairColour}`);
    if (hairSection?.textures[0]) {
      textures[HAIR_SLOT] = hairSection.textures[0];
    }

    const geosets = new Set(DEFAULT_CHARACTER_GEOSETS);
    const hair = (await this.#index('CharHairGeosets', (r) => `${r.race}:${r.sex}:${r.variation}`)).get(`${look.race}:${look.sex}:${look.hairStyle}`);
    if (hair && hair.geoset > 0) {
      geosets.add(hair.geoset);
    }
    const beard = (await this.#index('CharacterFacialHairStyles', (r) => `${r.race}:${r.sex}:${r.variation}`)).get(`${look.race}:${look.sex}:${look.facialHair}`);
    if (beard) {
      [100, 200, 300].forEach((group, i) => {
        if (beard.geosets[i] > 0) {
          geosets.delete(group + 1);
          geosets.add(group + beard.geosets[i]);
        }
      });
    }

    return { kind: 'model', path: body.path, textures, geosets: [...geosets].sort((a, b) => a - b), scale };
  }

  /** A weapon an NPC holds, by item id: its model and texture from the weapon folder */
  async weapon(itemId: number): Promise<ModelLook | null> {
    if (!(itemId > 0)) {
      return null;
    }

    const item = (await this.#table('Item'))?.getRecord(itemId);
    if (!item) {
      this.#warnOnce(`item:${itemId}`, `3D view: item ${itemId} is not in the client's Item.dbc; its NPC is drawn without it`);
      return null;
    }

    const display = (await this.#table('ItemDisplayInfo'))?.getRecord(item.displayInfoId);
    if (!display || !display.modelNames[0]) {
      return null;
    }

    // Shields have a folder of their own
    const shield = item.inventoryType === SHIELD_INVENTORY_TYPE;
    const folder = shield ? SHIELD_FOLDER : WEAPON_FOLDER;
    const textures: Record<number, string> = {};
    if (display.modelTextures[0]) {
      textures[WEAPON_SKIN_SLOT] = `${folder}\\${display.modelTextures[0]}.blp`;
    }
    const look: ModelLook = { kind: 'model', path: `${folder}\\${modelPath(display.modelNames[0])}`, textures, geosets: null, scale: 1 };
    if (shield) {
      look.shield = true;
    }
    return look;
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

  /**
   * A table's records by a key, built once per `cacheKey` (one table can be indexed more than one
   * way: CharSections by skin and by hair); a table that cannot be read gives an empty index
   */
  #index(name: string, keyOf: (record: any) => string | null, cacheKey = name) {
    let index = this.#indexes.get(cacheKey);
    if (!index) {
      index = this.#table(name).then((db) => {
        const byKey = new globalThis.Map<string, any>();
        for (const record of db?.records ?? []) {
          const key = keyOf(record);
          if (key !== null && !byKey.has(key)) byKey.set(key, record);
        }
        return byKey;
      });
      this.#indexes.set(cacheKey, index);
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
