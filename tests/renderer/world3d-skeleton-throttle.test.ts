import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import ModelSkeleton from '../../src/renderer/world3d/scene/model/ModelSkeleton';
import { animationFrozen, skeletonDue, skeletonInterval } from '../../src/renderer/world3d/scene/model/skeleton-schedule';
import ModelAnimator from '../../src/renderer/world3d/scene/model/ModelAnimator';

describe('posing distant models less often', () => {
  it('poses a near model every frame and further ones every second or fourth', () => {
    expect(skeletonInterval(30)).toBe(1);
    expect(skeletonInterval(150)).toBe(2);
    expect(skeletonInterval(400)).toBe(4);
  });

  it('spreads the models that wait over the frames, by their id', () => {
    const due = (id: number) => [0, 1, 2, 3, 4, 5, 6, 7].filter((frame) => skeletonDue(frame, id, 4));
    expect(due(0)).toEqual([0, 4]);
    expect(due(1)).toEqual([3, 7]);
    expect([0, 1, 2, 3].map((frame) => [0, 1, 2, 3].filter((id) => skeletonDue(frame, id, 4)).length)).toEqual([1, 1, 1, 1]);
    expect(skeletonDue(5, 9, 1)).toBe(true);
  });

  it('corrects a pose made for the camera as it was to the camera as it is, and to nothing once posed again', () => {
    const root: any = new THREE.Object3D();
    root.modelViewMatrix.copy(new THREE.Matrix4().makeTranslation(1, 2, 3));
    const skeleton = new ModelSkeleton(root, []);
    skeleton.update();
    expect(skeleton.viewCorrection.equals(new THREE.Matrix4())).toBe(true);

    const now = new THREE.Matrix4().makeRotationZ(0.5).setPosition(4, 5, 6);
    skeleton.correct(now);
    const corrected = skeleton.viewCorrection.clone().multiply(new THREE.Matrix4().makeTranslation(1, 2, 3));
    corrected.elements.forEach((value, i) => expect(value).toBeCloseTo(now.elements[i]!, 5));

    root.modelViewMatrix.copy(now);
    skeleton.update();
    expect(skeleton.viewCorrection.equals(new THREE.Matrix4())).toBe(true);
  });
});

describe('holding the animation of models too far to see move', () => {
  it('freezes beyond 250 yards and thaws nearer than 220, so a model at the edge does not flicker', () => {
    expect(animationFrozen(100, false)).toBe(false);
    expect(animationFrozen(251, false)).toBe(true);
    expect(animationFrozen(240, false)).toBe(false);
    expect(animationFrozen(240, true)).toBe(true);
    expect(animationFrozen(221, true)).toBe(true);
    expect(animationFrozen(219, true)).toBe(false);
  });

  const camera = () => {
    const c = new THREE.PerspectiveCamera();
    c.updateMatrixWorld();
    return c;
  };
  const fake = (at: number, id: number, skinned = true) => ({
    visible: true, skinned, id, posed: true, boundingSphereWorld: new THREE.Sphere(new THREE.Vector3(at, 0, 0), 1),
    updated: 0, carried: 0,
    updateSkeleton() { this.updated++; this.posed = true; }, carrySkeleton() { this.carried++; },
    animation: null as any,
  });

  it('freezes a far model, poses it no more but still carries its last pose, and thaws it when the camera comes near', () => {
    const animator = new ModelAnimator(new Uint32Array(), [], []);
    const near = fake(50, 0);
    const far = fake(400, 1);
    for (const model of [near, far]) model.animation = animator.createAnimation(model as never);
    animator.update(0.016, camera(), 0);
    expect(near.animation.frozen).toBe(false);
    expect(far.animation.frozen).toBe(true);
    const posed = far.updated;
    for (let frame = 1; frame <= 8; frame++) animator.update(0.016, camera(), frame);
    expect(far.updated).toBe(posed);
    expect(far.carried).toBeGreaterThan(0);
    expect(near.updated).toBeGreaterThan(0);

    far.boundingSphereWorld.center.x = 60;
    animator.update(0.016, camera(), 9);
    expect(far.animation.frozen).toBe(false);
  });

  it('poses a far model that has never been posed once, so it has a shape', () => {
    const animator = new ModelAnimator(new Uint32Array(), [], []);
    const far = fake(400, 1);
    far.posed = false;
    far.animation = animator.createAnimation(far as never);
    animator.update(0.016, camera(), 0);
    expect(far.updated).toBe(1);
  });

  it('freezes a far model that is not skinned too, and leaves a hidden one alone', () => {
    const animator = new ModelAnimator(new Uint32Array(), [], []);
    const plain = fake(400, 2, false);
    const hidden = fake(400, 3);
    hidden.visible = false;
    for (const model of [plain, hidden]) model.animation = animator.createAnimation(model as never);
    animator.update(0.016, camera(), 0);
    expect(plain.animation.frozen).toBe(true);
    expect(hidden.animation.frozen).toBe(false);
  });

  it('is told it is no longer frozen when it is shown again, which resumes it', () => {
    const animator = new ModelAnimator(new Uint32Array(), [], []);
    const far = fake(400, 1);
    far.animation = animator.createAnimation(far as never);
    animator.update(0.016, camera(), 0);
    expect(far.animation.frozen).toBe(true);
    far.animation.resume();
    expect(far.animation.frozen).toBe(false);
  });
});
