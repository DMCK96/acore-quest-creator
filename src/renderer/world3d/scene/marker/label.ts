import * as THREE from 'three';

/** How tall a label stands on screen (a share of the view's height), whatever its distance */
const LABEL_HEIGHT = 0.035;
const FONT_PX = 28;
const PAD_PX = 8;

/**
 * A line of text that always faces the camera at the same size on screen, drawn on an offscreen canvas;
 * null where there is none to draw on (outside a browser).
 */
export function textLabel(text: string, colour: number): THREE.Sprite | null {
  if (typeof OffscreenCanvas === 'undefined') return null;
  const font = `${FONT_PX}px sans-serif`;
  const measure = new OffscreenCanvas(1, 1).getContext('2d');
  if (!measure) return null;
  measure.font = font;
  const width = Math.ceil(measure.measureText(text).width) + PAD_PX * 2;
  const height = FONT_PX + PAD_PX * 2;
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = 'rgba(12, 10, 8, 0.7)';
  context.fillRect(0, 0, width, height);
  context.font = font;
  context.textBaseline = 'middle';
  context.fillStyle = `#${colour.toString(16).padStart(6, '0')}`;
  context.fillText(text, PAD_PX, height / 2);
  const material = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), sizeAttenuation: false, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.center.set(0.5, 0);
  sprite.scale.set((LABEL_HEIGHT * width) / height, LABEL_HEIGHT, 1);
  sprite.renderOrder = 4;
  return sprite;
}
