import * as THREE from 'three';
import type { Rect } from './scene/edit/box';

/**
 * The 3D view's camera, driven as in the game and in Noggit. Right-drag looks around in place;
 * left-drag on empty space orbits round the point under the cursor; middle-drag pans; the wheel moves
 * along the view. W/S fly forward and back the way the camera looks, A/D strafe, Q/E turn, Space/X
 * rise and sink, Shift goes faster. Keys act only while the view itself has focus, so typing in a
 * field never moves the camera. Z is up; angles are radians.
 *
 * In Select mode (Tab flips it) a left-drag draws a selection box instead of orbiting, and
 * Alt+left-drag orbits. Everything else is the same in both modes.
 */

/** Radians turned per pixel dragged, looking around and orbiting */
const LOOK_SPEED = 0.004;
/** Tilt stops this short of straight up and straight down */
const PITCH_LIMIT = Math.PI / 2 - 0.02;
/** Yards a second flown with the keys, and how much faster with Shift */
const FLY_SPEED = 30;
const FAST = 4;
/** Radians a second turned with Q and E */
const TURN_SPEED = 1.6;
/** Where an orbit turns when nothing is under the cursor: this many yards ahead */
const ORBIT_FALLBACK = 30;
/** A wheel notch (100 units) moves this share of the distance to what is ahead, but at least MIN_STEP */
const WHEEL_SHARE = 0.15;
const MIN_STEP = 2;
/** Yards panned per pixel, per yard to what is ahead */
const PAN_SCALE = 0.0015;
/** A left press that moves less than this many pixels before it is let go is a click, not an orbit */
const CLICK_SLOP = 4;

type Pick = (ndcX: number, ndcY: number) => THREE.Vector3 | null;

/** What a left-drag does: orbit (Camera) or draw a selection box (Select) */
export type Tool = 'camera' | 'select';
/** The keys held as a click or a box was let go */
export type ClickKeys = { shift: boolean; ctrl: boolean; alt: boolean };

type WorldControlsOptions = {
  /** The world point under a place on screen (normalised device coordinates), or null for sky */
  pick?: Pick;
  /** A left click, without dragging, at a place on screen (normalised device coordinates) */
  onClick?(ndcX: number, ndcY: number, keys: ClickKeys): void;
  /** A selection box drawn in Select mode, from where it started to where it was let go */
  onBox?(rect: Rect, keys: ClickKeys): void;
  /** Offered each wheel turn first; true when it was used (a falloff drag), so the camera does not move */
  onWheel?(deltaY: number): boolean;
  /** Told when Tab flipped the tool */
  onModeChange?(tool: Tool): void;
  /** True while a press belongs to something else on the view (the edit gizmo): no orbit, no click */
  blocked?(): boolean;
  /**
   * A right click without dragging, or the ContextMenu key (Shift+F10) at the last place the pointer
   * was over the view: asks for the menu, at a place on screen and where it is in the window
   */
  onContextClick?(ndcX: number, ndcY: number, client: { x: number; y: number }): void;
};

const UP = new THREE.Vector3(0, 0, 1);

class WorldControls {
  /** Where the map streams from: under the camera */
  readonly target = new THREE.Vector3();

  readonly #camera: THREE.PerspectiveCamera;
  readonly #dom: HTMLElement;
  readonly #pick: Pick;
  readonly #onClick: (ndcX: number, ndcY: number, keys: ClickKeys) => void;
  readonly #onBox: (rect: Rect, keys: ClickKeys) => void;
  readonly #onWheelClaim: (deltaY: number) => boolean;
  readonly #onModeChange: (tool: Tool) => void;
  readonly #blocked: () => boolean;
  readonly #onContextClick: (ndcX: number, ndcY: number, client: { x: number; y: number }) => void;
  /** Where the pointer last was over the view, for the menu key */
  #lastPointer: { x: number; y: number } | null = null;

  #mode: Tool = 'camera';
  /** The rectangle drawn over the view while a selection box is dragged */
  #marquee: HTMLDivElement | null = null;

  #yaw = 0;
  #pitch = 0;
  #pivot = new THREE.Vector3();
  #keys = new Set<string>();
  #drag: { button: number; x: number; y: number; startX: number; startY: number; panScale: number; box: boolean } | null = null;

  constructor(camera: THREE.PerspectiveCamera, dom: HTMLElement, options: WorldControlsOptions = {}) {
    this.#camera = camera;
    this.#dom = dom;
    this.#pick = options.pick ?? (() => null);
    this.#onClick = options.onClick ?? (() => {});
    this.#onBox = options.onBox ?? (() => {});
    this.#onWheelClaim = options.onWheel ?? (() => false);
    this.#onModeChange = options.onModeChange ?? (() => {});
    this.#blocked = options.blocked ?? (() => false);
    this.#onContextClick = options.onContextClick ?? (() => {});

    // Focusable, so keys can be kept to the view
    if (!dom.hasAttribute('tabindex')) dom.tabIndex = 0;
    dom.addEventListener('pointerdown', this.#onPointerDown);
    dom.addEventListener('pointermove', this.#onPointerMove);
    dom.addEventListener('pointerup', this.#onPointerUp);
    dom.addEventListener('pointercancel', this.#onPointerUp);
    dom.addEventListener('wheel', this.#onWheel, { passive: false });
    dom.addEventListener('contextmenu', this.#onContextMenu);
    dom.addEventListener('blur', this.#onBlur);
    window.addEventListener('keydown', this.#onKeyDown);
    window.addEventListener('keyup', this.#onKeyUp);

    this.#apply();
  }

  get mode(): Tool {
    return this.#mode;
  }

  setMode(tool: Tool): void {
    this.#mode = tool;
  }

  /** Puts the camera at `target + offset`, looking at `target` */
  setView(target: THREE.Vector3, offset: THREE.Vector3): void {
    this.#camera.position.copy(target).add(offset);
    this.#face(target.clone().sub(this.#camera.position));
    this.#apply();
  }

  /** Looks around in place, by pixels dragged */
  look(dx: number, dy: number): void {
    this.#yaw -= dx * LOOK_SPEED;
    this.#pitch = THREE.MathUtils.clamp(this.#pitch - dy * LOOK_SPEED, -PITCH_LIMIT, PITCH_LIMIT);
    this.#apply();
  }

  /** Picks what an orbit will turn round: the point under the cursor, else a short way ahead */
  startOrbit(ndcX: number, ndcY: number): void {
    this.#pivot = this.#pick(ndcX, ndcY) ?? this.#camera.position.clone().addScaledVector(this.#forward(), ORBIT_FALLBACK);
  }

  /** Orbits round the pivot, by pixels dragged, still looking at it */
  orbit(dx: number, dy: number): void {
    const offset = this.#camera.position.clone().sub(this.#pivot);
    const distance = offset.length();
    if (distance < 1e-6) return;

    // Round the vertical through the pivot, then up or down over it, short of the poles
    offset.applyAxisAngle(UP, -dx * LOOK_SPEED);
    const horizontal = Math.hypot(offset.x, offset.y);
    const elevation = THREE.MathUtils.clamp(Math.atan2(offset.z, horizontal) + dy * LOOK_SPEED, -PITCH_LIMIT, PITCH_LIMIT);
    const heading = Math.atan2(offset.y, offset.x);
    offset.set(Math.cos(elevation) * Math.cos(heading), Math.cos(elevation) * Math.sin(heading), Math.sin(elevation)).multiplyScalar(distance);

    this.#camera.position.copy(this.#pivot).add(offset);
    this.#face(offset.clone().negate());
    this.#apply();
  }

  /** Moves sideways and up or down with the view, by pixels dragged */
  pan(dx: number, dy: number, yardsPerPixel: number): void {
    const right = new THREE.Vector3().crossVectors(this.#forward(), UP).normalize();
    const up = new THREE.Vector3().crossVectors(right, this.#forward()).normalize();
    this.#camera.position.addScaledVector(right, -dx * yardsPerPixel).addScaledVector(up, dy * yardsPerPixel);
    this.#apply();
  }

  /** Moves along the view: positive is forward */
  dolly(yards: number): void {
    this.#camera.position.addScaledVector(this.#forward(), yards);
    this.#apply();
  }

  keyDown(code: string): void {
    if (this.#hasFocus()) this.#keys.add(code);
  }

  keyUp(code: string): void {
    this.#keys.delete(code);
  }

  /** Flies and turns with the keys held; `delta` in seconds */
  update(delta: number): void {
    if (this.#keys.size === 0 || !this.#hasFocus()) return;
    const held = (...codes: string[]) => codes.some((code) => this.#keys.has(code));
    const speed = FLY_SPEED * (held('ShiftLeft', 'ShiftRight') ? FAST : 1) * delta;

    const turn = (held('KeyQ') ? 1 : 0) - (held('KeyE') ? 1 : 0);
    if (turn !== 0) this.#yaw += turn * TURN_SPEED * delta;

    const forward = this.#forward();
    const right = new THREE.Vector3().crossVectors(forward, UP).normalize();
    const ahead = (held('KeyW', 'ArrowUp') ? 1 : 0) - (held('KeyS', 'ArrowDown') ? 1 : 0);
    const side = (held('KeyD', 'ArrowRight') ? 1 : 0) - (held('KeyA', 'ArrowLeft') ? 1 : 0);
    const rise = (held('Space') ? 1 : 0) - (held('KeyX') ? 1 : 0);
    this.#camera.position.addScaledVector(forward, ahead * speed).addScaledVector(right, side * speed).addScaledVector(UP, rise * speed);
    this.#apply();
  }

  dispose(): void {
    const dom = this.#dom;
    dom.removeEventListener('pointerdown', this.#onPointerDown);
    dom.removeEventListener('pointermove', this.#onPointerMove);
    dom.removeEventListener('pointerup', this.#onPointerUp);
    dom.removeEventListener('pointercancel', this.#onPointerUp);
    dom.removeEventListener('wheel', this.#onWheel);
    dom.removeEventListener('contextmenu', this.#onContextMenu);
    dom.removeEventListener('blur', this.#onBlur);
    window.removeEventListener('keydown', this.#onKeyDown);
    window.removeEventListener('keyup', this.#onKeyUp);
    this.#endMarquee();
  }

  #forward(): THREE.Vector3 {
    const c = Math.cos(this.#pitch);
    return new THREE.Vector3(c * Math.cos(this.#yaw), c * Math.sin(this.#yaw), Math.sin(this.#pitch));
  }

  /** Takes yaw and pitch from a direction to face */
  #face(direction: THREE.Vector3): void {
    this.#yaw = Math.atan2(direction.y, direction.x);
    this.#pitch = THREE.MathUtils.clamp(Math.atan2(direction.z, Math.hypot(direction.x, direction.y)), -PITCH_LIMIT, PITCH_LIMIT);
  }

  #apply(): void {
    const camera = this.#camera;
    camera.up.copy(UP);
    camera.lookAt(camera.position.clone().add(this.#forward()));
    camera.updateMatrixWorld();
    this.target.set(camera.position.x, camera.position.y, camera.position.z);
  }

  #hasFocus(): boolean {
    return document.activeElement === this.#dom;
  }

  #ndc(event: { clientX: number; clientY: number }): [number, number] {
    const rect = this.#dom.getBoundingClientRect();
    return [((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1, -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1];
  }

  /** Yards to what is at a place on screen, or a default when it is sky */
  #distanceAt(ndcX: number, ndcY: number): number {
    const hit = this.#pick(ndcX, ndcY);
    return hit ? hit.distanceTo(this.#camera.position) : ORBIT_FALLBACK * 2;
  }

  #onPointerDown = (event: PointerEvent): void => {
    this.#dom.focus();
    if (event.button === 0 && this.#blocked()) {
      this.#drag = null;
      return;
    }
    const [x, y] = this.#ndc(event);
    // In Select mode a left-drag draws a box; Alt still orbits
    const box = event.button === 0 && this.#mode === 'select' && !event.altKey;
    if (event.button === 0 && !box) this.startOrbit(x, y);
    const panScale = event.button === 1 ? Math.max(0.02, this.#distanceAt(x, y) * PAN_SCALE) : 0;
    this.#drag = { button: event.button, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, panScale, box };
    this.#dom.setPointerCapture?.(event.pointerId);
    if (event.button === 1) event.preventDefault();
  };

  /** Where the pointer last was over the view, or null when it has not been over it */
  get lastPointer(): { x: number; y: number } | null {
    return this.#lastPointer;
  }

  #onPointerMove = (event: PointerEvent): void => {
    this.#lastPointer = { x: event.clientX, y: event.clientY };
    const drag = this.#drag;
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (drag.box) this.#showMarquee(drag.startX, drag.startY, event.clientX, event.clientY);
    else if (drag.button === 2) this.look(dx, dy);
    else if (drag.button === 0) this.orbit(dx, dy);
    else if (drag.button === 1) this.pan(dx, dy, drag.panScale);
  };

  #onPointerUp = (event: PointerEvent): void => {
    const drag = this.#drag;
    this.#drag = null;
    this.#dom.releasePointerCapture?.(event.pointerId);
    this.#endMarquee();
    // A right press let go where it went down asks for the menu; one that moved was looking around
    if (event.type === 'pointerup' && drag?.button === 2 && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < CLICK_SLOP) {
      const [x, y] = this.#ndc(event);
      this.#onContextClick(x, y, { x: event.clientX, y: event.clientY });
      return;
    }
    if (event.type !== 'pointerup' || drag?.button !== 0) return;
    const keys = { shift: event.shiftKey, ctrl: event.ctrlKey || event.metaKey, alt: event.altKey };
    const [x, y] = this.#ndc(event);
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < CLICK_SLOP) {
      this.#onClick(x, y, keys);
    } else if (drag.box) {
      const [x0, y0] = this.#ndc({ clientX: drag.startX, clientY: drag.startY });
      this.#onBox({ x0, y0, x1: x, y1: y }, keys);
    }
  };

  /** The selection box's rectangle over the view, from where the drag started to where it is */
  #showMarquee(startX: number, startY: number, x: number, y: number): void {
    if (Math.hypot(x - startX, y - startY) < CLICK_SLOP && !this.#marquee) return;
    const host = this.#dom.parentElement;
    if (!host) return;
    if (!this.#marquee) {
      this.#marquee = document.createElement('div');
      this.#marquee.className = 'world3d__marquee';
      host.appendChild(this.#marquee);
    }
    const rect = this.#dom.getBoundingClientRect();
    const left = Math.min(startX, x) - rect.left + this.#dom.offsetLeft;
    const top = Math.min(startY, y) - rect.top + this.#dom.offsetTop;
    Object.assign(this.#marquee.style, { left: `${left}px`, top: `${top}px`, width: `${Math.abs(x - startX)}px`, height: `${Math.abs(y - startY)}px` });
  }

  #endMarquee(): void {
    this.#marquee?.remove();
    this.#marquee = null;
  }

  #onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (this.#onWheelClaim(event.deltaY)) return;
    const [x, y] = this.#ndc(event);
    const step = Math.max(MIN_STEP, this.#distanceAt(x, y) * WHEEL_SHARE) * (event.shiftKey ? FAST : 1);
    this.dolly((-event.deltaY / 100) * step);
  };

  #onContextMenu = (event: Event): void => event.preventDefault();

  #onBlur = (): void => this.#keys.clear();

  #onKeyDown = (event: KeyboardEvent): void => {
    if (!this.#hasFocus()) return;
    if (event.code === 'ContextMenu' || (event.code === 'F10' && event.shiftKey)) {
      event.preventDefault();
      const rect = this.#dom.getBoundingClientRect();
      const at = this.#lastPointer ?? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      const [x, y] = this.#ndc({ clientX: at.x, clientY: at.y });
      this.#onContextClick(x, y, at);
      return;
    }
    if (event.code === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      // Keeps focus on the view, and flips what a left-drag does
      event.preventDefault();
      this.#mode = this.#mode === 'camera' ? 'select' : 'camera';
      this.#onModeChange(this.#mode);
      return;
    }
    this.keyDown(event.code);
    // Space would scroll the page and the arrows would move a focused list
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
  };

  #onKeyUp = (event: KeyboardEvent): void => this.keyUp(event.code);
}

export { WorldControls };
export type { WorldControlsOptions };
