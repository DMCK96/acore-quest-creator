// @ts-nocheck
const WORLD_FADE_SIZE_DEFAULT = [1.0, 4.0, 15.0, 100.0, 100000.0];

const WORLD_FADE_DIST_DEFAULT = [30.0, 100.0, 200.0, 750.0, 1250.0];

const WORLD_FADE_RANGE_DEFAULT = [5.0, 10.0, 15.0, 20.0, 50.0];

const WORLD_FADE_SIZE = [1.0, 4.0, 15.0, 100.0, 100000.0];

const WORLD_FADE_DIST_MIN = [25.0, 90.0, 185.0, 730.0, 1200.0];

const WORLD_FADE_DIST_MAX = [30.0, 100.0, 200.0, 750.0, 1250.0];

const getSizeCategory = (size: number) => {
  let f: number;
  for (f = 0; f < WORLD_FADE_SIZE.length; f++) {
    if (size <= WORLD_FADE_SIZE[f]) {
      break;
    }
  }

  return f;
};

const getFade = (distance: number, sizeCategory: number) => {
  const min = WORLD_FADE_DIST_MIN[sizeCategory];
  const max = WORLD_FADE_DIST_MAX[sizeCategory];

  if (distance < min) {
    return 1.0;
  }

  if (distance > max) {
    return 0.0;
  }

  const fade = 1.0 - (distance - min) / (max - min);

  if (fade <= 0.0099999998) {
    return 0.0;
  }

  if (fade > 0.99000001) {
    return 1.0;
  }

  return fade;
};

const scaleFadeDist = (scale: number) => {
  for (let i = 0; i < WORLD_FADE_SIZE_DEFAULT.length; i++) {
    const first = i === 0;
    const last = i === WORLD_FADE_SIZE_DEFAULT.length - 1;
    const s = first || last ? 1.0 : scale;

    WORLD_FADE_SIZE[i] = WORLD_FADE_SIZE_DEFAULT[i];
    WORLD_FADE_DIST_MAX[i] = WORLD_FADE_DIST_DEFAULT[i] * s;
    WORLD_FADE_DIST_MIN[i] = WORLD_FADE_DIST_MAX[i] - WORLD_FADE_RANGE_DEFAULT[i];
  }
};

// TODO modify scale based on config
scaleFadeDist(1.5);

export {
  getFade,
  getSizeCategory,
  scaleFadeDist,
  WORLD_FADE_SIZE,
  WORLD_FADE_DIST_MIN,
  WORLD_FADE_DIST_MAX,
};
