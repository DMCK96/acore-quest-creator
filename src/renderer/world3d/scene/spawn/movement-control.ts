/** Whether the NPCs in the 3D view are walking, and how many times they were sent back home. */
export class MovementControl {
  private isPlaying = false;
  private resets = 0;

  get playing(): boolean {
    return this.isPlaying;
  }

  /** Counts resets, so every driver can tell one happened since it last looked */
  get epoch(): number {
    return this.resets;
  }

  play(): void {
    this.isPlaying = true;
  }

  pause(): void {
    this.isPlaying = false;
  }

  /** Sends every NPC home; whether they then walk is unchanged */
  reset(): void {
    this.resets += 1;
  }
}
