import type { CameraState, CameraTarget } from '@shared/ipc';

/** What the debug bridge may ask of the open World view: where the camera is, and a jump to a place */
export interface CameraHandle {
  status(): CameraState;
  /** Takes the camera to the place and returns where it is after; null when that map cannot be shown */
  teleport(target: CameraTarget): CameraState | null;
}

let current: CameraHandle | null = null;

/** The World view registers itself while it is mounted; returns the function that takes it back out */
export function registerCameraHandle(handle: CameraHandle): () => void {
  current = handle;
  return () => {
    if (current === handle) current = null;
  };
}

export const cameraHandle = (): CameraHandle | null => current;
