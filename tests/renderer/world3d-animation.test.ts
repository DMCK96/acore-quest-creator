// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import ModelAnimator from '../../src/renderer/world3d/scene/model/ModelAnimator';

const sequence = (id: number, variationIndex: number, flags = 0x20) => ({
  id,
  variationIndex,
  duration: 1000,
  moveSpeed: 0,
  flags,
  frequency: 0,
  blendTime: 0,
  variationNext: -1,
  aliasNext: 0,
});

const model = { visible: true, skinned: false } as never;

describe('a model whose stand animation has no first variation', () => {
  // 8KUL_CITYTREESHORT_B01.M2 in the Ascension client: stand (id 0) only as variations 1 and 2
  const animator = () => new ModelAnimator(new Uint32Array(), [sequence(2, 0), sequence(0, 1), sequence(0, 2)], []);

  it('still loads, playing the first variation it has', () => {
    const animation = animator().createAnimation(model);
    expect(animation).toBeDefined();
  });
});

describe('a model material whose texture transform has no animation', () => {
  it('draws untransformed instead of stopping the view', async () => {
    const THREE = await import('three');
    const { default: ModelMaterial } = await import('../../src/renderer/world3d/scene/model/ModelMaterial');
    // Seen at Stormwind Harbor in the Ascension client: a material names a transform the animation has
    // no state for (its tracks are all empty, so none was made)
    const material = new ModelMaterial('', '', [], 0, [0], 0);
    const animated = {
      animation: { textureWeights: [], textureTransforms: [], materialColors: [] },
      diffuseColor: new THREE.Color(1, 1, 1),
      emissiveColor: new THREE.Color(0, 0, 0),
      alpha: 1,
    } as never;
    expect(() => material.prepareMaterial(animated)).not.toThrow();
  });
});

describe('a model\'s gait', () => {
  const animation = (ids: number[]) => new ModelAnimator(new Uint32Array(), ids.map((id) => sequence(id, 0)), []).createAnimation(model);

  it('starts standing and plays the gait it is told', () => {
    const a = animation([0, 4, 5]);
    expect(a.gait).toBe('stand');
    a.setGait('walk');
    expect(a.gait).toBe('walk');
    a.setGait('run');
    expect(a.gait).toBe('run');
    a.setGait('stand');
    expect(a.gait).toBe('stand');
  });

  it('falls back to walk for a model that cannot run, and to stand for one that cannot walk', () => {
    const noRun = animation([0, 4]);
    noRun.setGait('run');
    expect(noRun.gait).toBe('walk');
    const stander = animation([0]);
    stander.setGait('walk');
    expect(stander.gait).toBe('stand');
  });

  it('can be changed while held still, taking effect without throwing', () => {
    const a = animation([0, 4, 5]);
    a.suspend();
    expect(() => a.setGait('walk')).not.toThrow();
    expect(a.gait).toBe('walk');
    expect(() => a.resume()).not.toThrow();
    expect(a.gait).toBe('walk');
  });

  it('falls back past a gait whose animation is not in the model file (an external .anim) (I4)', () => {
    const external = new ModelAnimator(new Uint32Array(), [sequence(0, 0), sequence(4, 0, 0), sequence(5, 0)], []).createAnimation(model);
    external.setGait('walk');
    expect(external.gait).toBe('stand');
    external.setGait('run');
    expect(external.gait).toBe('run');
    const noRun = new ModelAnimator(new Uint32Array(), [sequence(0, 0), sequence(4, 0), sequence(5, 0, 0)], []).createAnimation(model);
    noRun.setGait('run');
    expect(noRun.gait).toBe('walk');
  });

  it('cannot have its gait set from outside, only read (M7)', () => {
    const a = animation([0, 4]);
    expect(() => { (a as { gait: string }).gait = 'run'; }).toThrow();
    expect(a.gait).toBe('stand');
  });
});
