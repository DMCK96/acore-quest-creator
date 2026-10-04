// @ts-nocheck
const _scratch = new Float32Array(3);

const expandExtent = (extent: Float32Array, expand: Float32Array) => {
  extent[0] = Math.min(extent[0], expand[0]);
  extent[1] = Math.min(extent[1], expand[1]);
  extent[2] = Math.min(extent[2], expand[2]);

  extent[3] = Math.max(extent[3], expand[3]);
  extent[4] = Math.max(extent[4], expand[4]);
  extent[5] = Math.max(extent[5], expand[5]);
};

const getBoundsCenter = (extent: Float32Array) => {
  const center = new Float32Array(3);

  center[0] = (extent[0] + extent[3]) * 0.5;
  center[1] = (extent[1] + extent[4]) * 0.5;
  center[2] = (extent[2] + extent[5]) * 0.5;

  return center;
};

const getBoundsRadius = (extent: Float32Array) => {
  _scratch[0] = extent[3] - extent[0];
  _scratch[1] = extent[4] - extent[1];
  _scratch[2] = extent[5] - extent[2];

  const size = Math.sqrt(
    _scratch[0] * _scratch[0] + _scratch[1] * _scratch[1] + _scratch[2] * _scratch[2],
  );

  return size * 0.5;
};

export { expandExtent, getBoundsCenter, getBoundsRadius };
