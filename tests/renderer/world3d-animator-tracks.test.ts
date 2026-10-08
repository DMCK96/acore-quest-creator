// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createAnimator } from '../../src/renderer/world3d/scene/model/animator-tracks';
import type { ModelSpec } from '../../src/renderer/world3d/scene/model/loader/types';

const LINEAR = 1;
const LOOP_MS = 1000;
const empty = { trackType: LINEAR, loopIndex: 0, sequenceTimes: [], sequenceKeys: [] };
/** A track on the model's first loop, from one key at 0 ms to the next at the loop's end */
const looped = (from: number[], to: number[]) => ({
  trackType: LINEAR,
  loopIndex: 0,
  sequenceTimes: [new Uint32Array([0, LOOP_MS])],
  sequenceKeys: [new Float32Array([...from, ...to])],
});

/** A model with one looping texture transform, its tracks as given (empty unless named) */
const specWith = (transform: Partial<Record<'translationTrack' | 'rotationTrack' | 'scalingTrack', unknown>>) =>
  ({
    loops: new Uint32Array([LOOP_MS]),
    sequences: [],
    bones: [],
    skinned: false,
    textureWeights: [],
    materialColors: [],
    textureTransforms: [{ translationTrack: empty, rotationTrack: empty, scalingTrack: empty, ...transform }],
  }) as unknown as ModelSpec;

/** What the animator asks of a model: whether it is shown, how far it is, and its animation (set once made) */
const newModel = () => ({ visible: true, skinned: false, boundingSphereWorld: new THREE.Sphere(), animation: null as unknown }) as never;
const camera = new THREE.PerspectiveCamera();

describe('texture transform tracks', () => {
  it('turn the texture: a rotating texture animation plays', () => {
    // A quarter turn about Z over the loop: halfway through, an eighth of a turn
    const quarter = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    const animator = createAnimator(specWith({ rotationTrack: looped([0, 0, 0, 1], quarter.toArray()) }))!;
    const model = newModel();
    const animation = animator.createAnimation(model);
    (model as { animation: unknown }).animation = animation;

    animator.update(LOOP_MS / 2 / 1000, camera);

    const eighth = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 4);
    expect(animation.textureTransforms[0]!.rotation.angleTo(eighth)).toBeLessThan(1e-3);
  });

  it('move and scale the texture too', () => {
    const animator = createAnimator(specWith({ translationTrack: looped([0, 0, 0], [1, 0, 0]), scalingTrack: looped([1, 1, 1], [3, 1, 1]) }))!;
    const model = newModel();
    const animation = animator.createAnimation(model);
    (model as { animation: unknown }).animation = animation;

    animator.update(LOOP_MS / 2 / 1000, camera);

    expect(animation.textureTransforms[0]!.translation.x).toBeCloseTo(0.5);
    expect(animation.textureTransforms[0]!.scaling.x).toBeCloseTo(2);
  });
});

describe('a model with no loops or sequences', () => {
  it('has no animator', () => {
    expect(createAnimator({ ...specWith({}), loops: new Uint32Array() } as ModelSpec)).toBeNull();
  });
});
