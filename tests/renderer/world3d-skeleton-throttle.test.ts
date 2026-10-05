import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import ModelSkeleton from '../../src/renderer/world3d/scene/model/ModelSkeleton';
import { skeletonDue, skeletonInterval } from '../../src/renderer/world3d/scene/model/skeleton-schedule';

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
