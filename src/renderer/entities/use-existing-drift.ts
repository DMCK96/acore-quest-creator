import { useEffect, useState } from 'react';
import type { Api } from '@shared/ipc';
import type { EntityRef, TrackedEntity } from '@core/entities/entity';

/**
 * The project's existing NPCs, objects and items whose rows the world database changed since they were
 * brought in. Read when shown, again when the existing ones in the project change (one brought in, put
 * back, or an undo), and when `seq` moves. Nothing is drifted while it cannot be read.
 */
export function useExistingDrift(api: Api | null, tracked: readonly TrackedEntity[], seq = 0): EntityRef[] {
  const [drifted, setDrifted] = useState<EntityRef[]>([]);
  const existing = tracked.filter((e) => e.origin === 'existing').map((e) => `${e.kind}:${e.entry}`).join(',');
  useEffect(() => {
    if (!api || existing === '') {
      setDrifted([]);
      return;
    }
    let live = true;
    void api.existingDrift().then((result) => {
      if (live) setDrifted(result.ok ? result.value : []);
    });
    return () => {
      live = false;
    };
  }, [api, existing, seq]);
  return drifted;
}
