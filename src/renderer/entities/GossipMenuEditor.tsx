import type { CustomNpc, GossipMenu, GossipOption, GossipTree, TextVariant } from '@core/entities/model';
import { nextOptionId } from '@core/entities/gossip-tree';
import { GOSSIP_SERVICES, serviceFlagBits, serviceLabel, serviceOf } from '@core/game/gossip-services';
import { NumberField, SelectField, TextField } from '../scripts/fields';

const MAX_VARIANTS = 8;
const NEW_MENU = '__new';

/** The bits of `npcflag` the editor sets from the NPC's own fields; the rest of the original row's stay as they were */
const FLAG_GOSSIP = 1;
const FLAG_QUEST_GIVER = 2;
const FLAG_TRAINER = 16;
const FLAG_VENDOR = 128;

/** What an NPC can do now, as `npcflag` bits: its original row's, with the ones its own fields set laid over */
function flagsOf(npc: CustomNpc): number {
  const original = npc.origin.kind === 'existing' ? Number(npc.origin.original.creature_template?.[0]?.npcflag ?? 0) : 0;
  return (original & ~(FLAG_GOSSIP | FLAG_QUEST_GIVER | FLAG_TRAINER | FLAG_VENDOR)) |
    // A new NPC is given the other flags its service options need when it is exported
    (npc.origin.kind === 'existing' ? 0 : serviceFlagBits(npc.gossipMenu)) | (npc.gossip ? FLAG_GOSSIP : 0) | (npc.questGiver ? FLAG_QUEST_GIVER : 0) | (npc.trainer ? FLAG_TRAINER : 0) | (npc.vendor.length > 0 ? FLAG_VENDOR : 0);
}

/** How a menu is named in a list: its first line of greeting, else its place */
export const menuLabel = (menu: GossipMenu, index: number): string => menu.greeting[0]?.text.trim() || `Menu ${index + 1}`;

/** The value of the Does select for an action */
const doesOf = (option: GossipOption): string =>
  option.action.kind === 'service' ? `service:${option.action.type}/${option.action.npcFlag}` : option.action.kind;

/** Why a service option would never show, and where to fix it */
function ServiceNote({ option, npc, onTab }: { option: GossipOption; npc: CustomNpc; onTab?: (id: string) => void }): React.JSX.Element | null {
  const action = option.action;
  if (action.kind !== 'service' || action.npcFlag <= 1 || (flagsOf(npc) & action.npcFlag) === action.npcFlag) return null;
  const service = serviceOf(action.type, action.npcFlag);
  const fix = service?.id === 'vendor' ? 'vendor' : service?.id === 'trainer' ? 'trainer' : null;
  return (
    <p className="scene-hint">
      {fix ? `This NPC is not a ${fix}, so this option would never show.` : `This NPC is not set up for ${serviceLabel(action.type, action.npcFlag).toLowerCase()}, so this option would never show.`}
      {fix && onTab && (
        <>
          {' '}
          <button type="button" className="btn" onClick={() => onTab(fix)}>
            Make it a {fix}
          </button>
        </>
      )}
    </p>
  );
}

/** The greeting and options of one menu the NPC owns */
export function GossipMenuEditor({
  npc, tree, index, onChange, newMenu, onTab,
}: {
  npc: CustomNpc;
  tree: GossipTree;
  index: number;
  /** The tree with this menu (and any menu it made) changed */
  onChange(next: GossipTree): void;
  /** Makes a new, blank menu with fresh ids; null when none could be got */
  newMenu(): Promise<GossipMenu | null>;
  onTab?(id: string): void;
}): React.JSX.Element {
  const menu = tree.menus[index]!;
  const setMenu = (next: GossipMenu): GossipTree => ({ menus: tree.menus.map((m, i) => (i === index ? next : m)) });
  const setOption = (i: number, option: GossipOption): void => onChange(setMenu({ ...menu, options: menu.options.map((o, j) => (j === i ? option : o)) }));
  const setVariant = (i: number, variant: TextVariant): void => onChange(setMenu({ ...menu, greeting: menu.greeting.map((v, j) => (j === i ? variant : v)) }));
  const others = tree.menus.filter((_, i) => i !== index);
  /** The scene of the NPC that waits for this option, if any: the option cannot be removed while it does */
  const sceneOf = (o: GossipOption) => npc.scenes.find((s) => s.trigger.kind === 'gossipPicked' && s.trigger.menuId === menu.menuId && s.trigger.optionId === o.optionId);
  // The ids the database gave this menu's options: a new option never takes one of them, though it was removed (conditions and scripts name them)
  const hadIds = npc.origin.kind === 'existing' ? (npc.origin.original.gossip_menu_option ?? []).filter((r) => Number(r.MenuID) === menu.menuId).map((r) => Number(r.OptionID)) : [];

  /** Sets what an option does; opening a menu with none to open makes one */
  async function doesChange(i: number, option: GossipOption, does: string): Promise<void> {
    if (does === 'close') return setOption(i, { ...option, action: { kind: 'close' } });
    if (does === 'menu') {
      const target = others[0];
      if (target) return setOption(i, { ...option, action: { kind: 'menu', menuId: target.menuId } });
      const made = await newMenu();
      if (!made) return;
      return onChange({ menus: [...tree.menus.map((m, k) => (k === index ? { ...m, options: m.options.map((o, j) => (j === i ? { ...option, action: { kind: 'menu' as const, menuId: made.menuId } } : o)) } : m)), made] });
    }
    const [type, npcFlag] = does.slice('service:'.length).split('/').map(Number) as [number, number];
    const service = serviceOf(type, npcFlag);
    return setOption(i, { ...option, icon: option.icon === 0 && service ? service.icon : option.icon, action: { kind: 'service', type, npcFlag } });
  }

  async function pickMenu(i: number, option: GossipOption, value: string): Promise<void> {
    if (value !== NEW_MENU) return setOption(i, { ...option, action: { kind: 'menu', menuId: Number(value) } });
    const made = await newMenu();
    if (!made) return;
    onChange({ menus: [...tree.menus.map((m, k) => (k === index ? { ...m, options: m.options.map((o, j) => (j === i ? { ...option, action: { kind: 'menu' as const, menuId: made.menuId } } : o)) } : m)), made] });
  }

  return (
    <div className="scene-section">
      <h4 className="scene-section__title">Greeting</h4>
      <ol className="scene-steps" aria-label="Greeting">
        {menu.greeting.map((v, i) => (
          <li key={i} className="scene-step">
            <TextField label="Text" long value={v.text} onChange={(text) => setVariant(i, { ...v, text })} />
            <TextField label="Female text" long value={v.textFemale} onChange={(textFemale) => setVariant(i, { ...v, textFemale })} />
            <NumberField label="Chance" value={v.probability} min={0} onChange={(probability) => setVariant(i, { ...v, probability: Math.max(0, probability) })} />
            {menu.greeting.length > 1 && (
              <button type="button" className="entry-card__btn entry-card__btn--danger" onClick={() => onChange(setMenu({ ...menu, greeting: menu.greeting.filter((_, j) => j !== i) }))}>
                Remove variant
              </button>
            )}
          </li>
        ))}
      </ol>
      {menu.greeting.length < MAX_VARIANTS && (
        <button type="button" className="btn" onClick={() => onChange(setMenu({ ...menu, greeting: [...menu.greeting, { text: '', textFemale: '', probability: 1 }] }))}>
          Add variant
        </button>
      )}
      <h4 className="scene-section__title">Options</h4>
      <ol className="scene-steps" aria-label="Options">
        {menu.options.map((o, i) => {
          const action = o.action;
          const inTree = action.kind === 'menu' && tree.menus.some((m) => m.menuId === action.menuId);
          const doesOptions: (readonly [string, string])[] = [
            ['close', 'Closes the window'],
            ['menu', 'Opens menu…'],
            ...GOSSIP_SERVICES.map((s) => [`service:${s.type}/${s.npcFlag}`, s.label] as const),
            ...(action.kind === 'service' && !serviceOf(action.type, action.npcFlag) ? [[doesOf(o), serviceLabel(action.type, action.npcFlag)] as const] : []),
          ];
          return (
            <li key={o.optionId} className="scene-step">
              <div className="scene-step__head">
                <strong>Option {i + 1}</strong>
                {!o.kept && (
                  <button type="button" className="entry-card__btn entry-card__btn--danger" disabled={sceneOf(o) !== undefined} onClick={() => onChange(setMenu({ ...menu, options: menu.options.filter((_, j) => j !== i) }))}>
                    Remove
                  </button>
                )}
              </div>
              <div className="scene-row">
                <NumberField label="Icon" value={o.icon} min={0} onChange={(icon) => setOption(i, { ...o, icon: Math.max(0, Math.round(icon)) })} />
                <TextField label="Text" value={o.text} onChange={(text) => setOption(i, { ...o, text })} />
              </div>
              <SelectField label="Does" value={doesOf(o)} options={doesOptions} disabled={o.kept} onChange={(does) => void doesChange(i, o, does)} />
              {action.kind === 'menu' && (
                <div className="scene-row">
                  <SelectField
                    label="Menu"
                    value={String(action.menuId)}
                    disabled={o.kept}
                    options={[
                      ...tree.menus.map((m, k) => [String(m.menuId), menuLabel(m, k)] as const),
                      // A menu the database has, not one of this NPC's: shown by its id
                      ...(inTree ? [] : [[String(action.menuId), `Menu ${action.menuId}`] as const]),
                      [NEW_MENU, 'New menu…'],
                    ]}
                    onChange={(value) => void pickMenu(i, o, value)}
                  />
                  <NumberField label="Menu id" value={action.menuId} min={1} disabled={o.kept} onChange={(menuId) => setOption(i, { ...o, action: { kind: 'menu', menuId: Math.max(1, Math.round(menuId)) } })} />
                </div>
              )}
              {o.kept && <p className="scene-hint">Kept as it is: the database ties it to a condition or a script.</p>}
              {sceneOf(o) && (
                <p className="scene-hint">
                  Runs the scene {sceneOf(o)!.name.trim() || sceneOf(o)!.id}{' '}
                  <button type="button" className="btn" onClick={() => onTab?.('scripts')}>
                    Go to scripts
                  </button>
                </p>
              )}
              <ServiceNote option={o} npc={npc} onTab={onTab} />
            </li>
          );
        })}
      </ol>
      <button type="button" className="btn" onClick={() => onChange(setMenu({ ...menu, options: [...menu.options, { optionId: nextOptionId(menu, hadIds), icon: 0, text: '', action: { kind: 'close' }, kept: false }] }))}>
        Add option
      </button>
      {index > 0 && !menu.options.some((o) => o.kept || sceneOf(o)) && (
        <button type="button" className="btn" onClick={() => onChange({ menus: tree.menus.filter((_, i) => i !== index) })}>
          Remove menu
        </button>
      )}
    </div>
  );
}
