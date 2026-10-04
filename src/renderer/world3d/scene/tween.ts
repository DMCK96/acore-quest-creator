// @ts-nocheck
import * as TWEEN from '@tweenjs/tween.js';

const updateTween = (time: number) => {
  TWEEN.update(time);

  requestAnimationFrame(updateTween);
};

requestAnimationFrame(updateTween);
