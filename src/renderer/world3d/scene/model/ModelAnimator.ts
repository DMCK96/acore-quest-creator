// @ts-nocheck
import * as THREE from 'three';
import { M2Track } from '@wowserhq/format';
import { BoneSpec, SequenceSpec } from './loader/types.js';
import ModelAnimation from './ModelAnimation.js';
import Model from './Model.js';
import { getTrackInterpolation } from './util.js';
import { skeletonDue, skeletonInterval } from './skeleton-schedule.js';

interface Constructor<T> {
  new (...args: any[]): T;
}

type TrackIdentity = {
  state: string;
  index?: number;
  property?: string;
};

const _cameraPosition = new THREE.Vector3();

class ModelAnimator {
  #mixer: THREE.AnimationMixer;

  #loops: number[] = [];
  #loopClips: THREE.AnimationClip[] = [];

  #sequencesByIndex: SequenceSpec[] = [];
  #sequences: Map<number, SequenceSpec[]> = new Map();
  #sequenceClips: Map<number, THREE.AnimationClip[]> = new Map();

  #bones: BoneSpec[] = [];

  #stateCounts: Record<string, number> = {};

  #modelsByAnimation: Map<ModelAnimation, Model> = new Map();

  constructor(loops: Uint32Array, sequences: SequenceSpec[], bones: BoneSpec[]) {
    this.#mixer = new THREE.AnimationMixer(new THREE.Object3D());
    this.#mixer.timeScale = 1000;

    for (const loop of loops) {
      this.#registerLoop(loop);
    }

    for (const sequence of sequences) {
      this.#registerSequence(sequence);
    }

    this.#bones = bones;
  }

  createAnimation(model: Model) {
    const animation = new ModelAnimation(model, this, this.#bones, this.#stateCounts);
    this.#modelsByAnimation.set(animation, model);

    return animation;
  }

  get loops() {
    return this.#loops;
  }

  get sequences() {
    return this.#sequences;
  }

  clearAction(action: THREE.AnimationAction) {
    action.stop();
    this.#mixer.uncacheAction(action.getClip());
  }

  clearAnimation(animation: ModelAnimation) {
    this.#modelsByAnimation.delete(animation);
  }

  /** Advances the animations, and poses each shown model: distant ones only every few frames */
  update(deltaTime: number, camera: THREE.Camera, frame = 0) {
    this.#mixer.update(deltaTime);
    _cameraPosition.setFromMatrixPosition(camera.matrixWorld);

    for (const model of this.#modelsByAnimation.values()) {
      if (!model.visible) {
        continue;
      }

      if (model.skinned) {
        const interval = skeletonInterval(model.boundingSphereWorld.center.distanceTo(_cameraPosition));
        if (!model.posed || skeletonDue(frame, model.id, interval)) {
          model.updateSkeleton(camera);
        } else {
          model.carrySkeleton(camera);
        }
      }
    }
  }

  getLoop(root: THREE.Object3D, index: number) {
    const clip = this.#loopClips[index];
    return this.#mixer.clipAction(clip, root);
  }

  getSequence(root: THREE.Object3D, id: number, variationIndex: number) {
    const clip = this.#sequenceClips.get(id)[variationIndex];
    return this.#mixer.clipAction(clip, root);
  }

  registerTrack<T extends THREE.TypedArray>(
    identity: TrackIdentity,
    track: M2Track<T>,
    TrackType: Constructor<THREE.KeyframeTrack>,
    transform?: (value: any) => any,
  ) {
    // Empty track
    if (track.sequenceTimes.length === 0 || track.sequenceKeys.length === 0) {
      return;
    }

    // Name
    let name: string;
    if (identity.index === undefined && identity.property === undefined) {
      name = `.${identity.state}`;
    } else if (identity.index !== undefined && identity.property === undefined) {
      name = `.${identity.state}[${identity.index}]`;
    } else if (identity.index !== undefined && identity.property !== undefined) {
      name = `.${identity.state}[${identity.index}].${identity.property}`;
    } else {
      throw new Error(`Unsupported track identity: ${identity.state}`);
    }

    // State counts
    if (identity.index !== undefined) {
      const currentCount = this.#stateCounts[identity.state] ?? 0;
      const newCount = identity.index + 1;
      if (newCount > currentCount) {
        this.#stateCounts[identity.state] = newCount;
      }
    }

    if (track.loopIndex === 0xffff) {
      this.#registerSequenceTrack(name, track, TrackType, transform);
    } else {
      this.#registerLoopTrack(name, track, TrackType, transform);
    }
  }

  #registerLoopTrack<T extends THREE.TypedArray>(
    name: string,
    track: M2Track<T>,
    TrackType: Constructor<THREE.KeyframeTrack>,
    transform?: (value: any) => any,
  ) {
    const clip = this.#loopClips[track.loopIndex];

    for (let s = 0; s < track.sequenceTimes.length; s++) {
      const times = track.sequenceTimes[s];
      const values = transform
        ? Array.from(track.sequenceKeys[s]).map((value) => transform(value))
        : track.sequenceKeys[s];

      // Empty loop
      if (times.length === 0 || values.length === 0) {
        continue;
      }

      clip.tracks.push(new TrackType(name, times, values, getTrackInterpolation(track.trackType)));
    }
  }

  #registerSequenceTrack<T extends THREE.TypedArray>(
    name: string,
    track: M2Track<T>,
    TrackType: Constructor<THREE.KeyframeTrack>,
    transform?: (value: any) => any,
  ) {
    for (let s = 0; s < track.sequenceTimes.length; s++) {
      const sequence = this.#sequencesByIndex[s];
      const clip = this.#sequenceClips.get(sequence.id)[sequence.variationIndex];

      const times = track.sequenceTimes[s];
      const values = transform
        ? Array.from(track.sequenceKeys[s]).map((value) => transform(value))
        : track.sequenceKeys[s];

      // Empty sequence
      if (times.length === 0 || values.length === 0) {
        continue;
      }

      clip.tracks.push(new TrackType(name, times, values, getTrackInterpolation(track.trackType)));
    }
  }

  #registerLoop(duration: number) {
    const index = this.#loops.length;
    this.#loops[index] = duration;
    this.#loopClips[index] = new THREE.AnimationClip(`loop-${index}`, duration, []);
  }

  #registerSequence(spec: SequenceSpec) {
    if (!this.#sequences.has(spec.id)) {
      this.#sequences.set(spec.id, []);
      this.#sequenceClips.set(spec.id, []);
    }

    this.#sequences.get(spec.id)[spec.variationIndex] = spec;
    this.#sequencesByIndex.push(spec);

    const clipName = `sequence-${spec.id}-${spec.variationIndex}`;
    const clip = new THREE.AnimationClip(clipName, spec.duration, []);
    this.#sequenceClips.get(spec.id)[spec.variationIndex] = clip;
  }
}

export default ModelAnimator;
