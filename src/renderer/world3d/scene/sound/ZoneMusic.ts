// @ts-nocheck
import { SoundEntriesRecord, ZoneMusicRecord } from '@wowserhq/format';
import { SOUND_AMBIENCE } from './const.js';
import { getRandomInt } from './util.js';
import SoundManager from './SoundManager.js';

enum STATE {
  STATE_INITIALIZED = 0,
  STATE_SILENT,
  STATE_PLAYING,
  STATE_STOPPING,
}

const SCHEDULE_INTERVAL = 1000;
const FADE_OUT = 4000;

class ZoneMusic {
  #soundManager: SoundManager;
  #ambience: SOUND_AMBIENCE;

  // Tracks the timeout ID for the scheduling loop
  #scheduleTimeout: ReturnType<typeof setTimeout>;

  #state: STATE;

  #musicRecord: ZoneMusicRecord;
  #soundRecords: SoundEntriesRecord[];

  #lastPlay: number;
  #nextPlay: number;

  constructor(soundManager: SoundManager) {
    this.#soundManager = soundManager;
    this.#ambience = SOUND_AMBIENCE.AMBIENCE_DAY;
    this.#state = STATE.STATE_INITIALIZED;
    this.#lastPlay = null;
    this.#nextPlay = null;

    // Kick off scheduling loop
    this.#schedule().catch((error) => console.error(error));
  }

  get ambience() {
    return this.#ambience;
  }

  set ambience(ambience: SOUND_AMBIENCE) {
    this.#ambience = ambience;
  }

  get lastPlay() {
    return this.#lastPlay;
  }

  get nextPlay() {
    return this.#nextPlay;
  }

  set(musicRecord: ZoneMusicRecord, soundRecords: SoundEntriesRecord[]) {
    // Treat setting same music as a noop
    if (this.#musicRecord?.id === musicRecord?.id) {
      return;
    }

    this.#musicRecord = musicRecord;
    this.#soundRecords = soundRecords;

    // Avoid carrying zone music across zones
    if (this.#state === STATE.STATE_PLAYING) {
      this.#stop(FADE_OUT);
    }
  }

  clear() {
    this.#musicRecord = null;
    this.#soundRecords = null;
  }

  dispose() {
    clearTimeout(this.#scheduleTimeout);
    this.clear();
    this.#soundManager = null;
  }

  #stop(duration: number) {
    this.#state = STATE.STATE_STOPPING;

    this.#soundManager.stopMusic(duration);
  }

  #getNextPlay() {
    const silenceMin = this.#musicRecord.silenceIntervalMin[this.#ambience];
    const silenceMax = this.#musicRecord.silenceIntervalMax[this.#ambience];

    return Date.now() + getRandomInt(silenceMin, silenceMax);
  }

  #play() {
    // Select sound entries for current ambience (day / night)
    const soundEntries = this.#soundRecords[this.#ambience];

    this.#state = STATE.STATE_PLAYING;

    return this.#soundManager.playMusic(soundEntries, () => {
      this.#lastPlay = Date.now();
      this.#nextPlay = null;
      this.#state = STATE.STATE_SILENT;
    });
  }

  async #evaluate() {
    if (!this.#musicRecord) {
      return;
    }

    if (this.#state === STATE.STATE_PLAYING) {
      return;
    }

    if (this.#state === STATE.STATE_INITIALIZED) {
      return this.#play();
    }

    if (this.#state === STATE.STATE_SILENT) {
      if (this.#nextPlay === null) {
        this.#nextPlay = this.#getNextPlay();
      }

      if (Date.now() > this.#nextPlay) {
        return this.#play();
      }
    }
  }

  async #schedule() {
    // Schedule or play music
    await this.#evaluate();

    // Tee up the next tick of the scheduling loop
    this.#scheduleTimeout = setTimeout(() => this.#schedule(), SCHEDULE_INTERVAL);
  }
}

export default ZoneMusic;
