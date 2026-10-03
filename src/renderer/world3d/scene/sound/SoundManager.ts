// @ts-nocheck
import * as THREE from 'three';
import * as TWEEN from '@tweenjs/tween.js';
import { ClientDb, SoundEntriesRecord, ZoneMusicRecord } from '@wowserhq/format';
import DbManager from '../db/DbManager.js';
import { AssetHost, loadAsset, normalizePath } from '../asset.js';
import ZoneMusic from './ZoneMusic.js';
import { getRandomInt } from './util.js';

type SoundManagerOptions = {
  host: AssetHost;
  dbManager?: DbManager;
};

class SoundManager {
  #host: AssetHost;

  #loadedSounds = new Map<string, AudioBuffer>();
  #loadingSounds = new Map<string, Promise<AudioBuffer>>();

  // The primary AudioContext used for playback of sounds
  #listeningContext: AudioContext;

  // An OfflineAudioContext used to decode sound files (avoids spurious Chrome warnings about
  // creating an AudioContext before user interaction)
  #decodingContext: OfflineAudioContext;

  #camera: THREE.Camera;

  #dbManager: DbManager;
  #zoneMusicDb: ClientDb<ZoneMusicRecord>;
  #soundEntriesDb: ClientDb<SoundEntriesRecord>;

  #desiredZoneMusicId: number;
  #currentZoneMusicId: number;
  #zoneMusic: ZoneMusic;

  #musicListener: THREE.AudioListener;
  #musicSource: THREE.Audio;

  constructor(options: SoundManagerOptions) {
    this.#host = options.host;
    this.#dbManager = options.dbManager ?? new DbManager({ host: options.host });

    this.#decodingContext = new OfflineAudioContext(2, 44100 * 5, 44100);

    this.#zoneMusic = new ZoneMusic(this);

    this.#loadDbs().catch((error) => console.error(error));
    this.#syncZoneMusic().catch((error) => console.error(error));
  }

  setZoneMusic(zoneMusicId: number) {
    this.#desiredZoneMusicId = zoneMusicId;
  }

  #initializeAudioSources() {
    this.#listeningContext = THREE.AudioContext.getContext();

    this.#musicListener = new THREE.AudioListener();
    this.#musicSource = new THREE.Audio(this.#musicListener);
  }

  dispose() {
    this.stopMusic(0);
    this.#zoneMusic.dispose();
  }

  playMusic(soundEntries: SoundEntriesRecord, onEnded?: () => void) {
    if (!this.#musicSource) {
      this.#initializeAudioSources();
    }

    this.#musicSource.setVolume(soundEntries.volumeFloat);

    return this.#playSoundEntries(this.#musicSource, soundEntries, onEnded);
  }

  stopMusic(duration: number = 0) {
    const props = { volume: this.#musicSource.getVolume() };
    const tween = new TWEEN.Tween(props)
      .to({ volume: 0.0 }, duration)
      .onUpdate(() => {
        this.#musicSource.setVolume(props.volume);
      })
      .onComplete(() => {
        this.#musicSource.stop();
        this.#musicSource.onEnded();
      });
    tween.start();
  }

  async #playSoundEntries(
    audioSource: THREE.Audio,
    soundEntries: SoundEntriesRecord,
    onEnded?: () => void,
  ) {
    // Source is in use
    if (audioSource.isPlaying) {
      return;
    }

    // Filter out empty file entries
    const soundFiles = soundEntries.file.filter((file) => file.trim().length > 0);

    // TODO use freq as weight
    const soundFile = soundFiles[getRandomInt(0, soundFiles.length - 1)];
    const soundPath = `${soundEntries.directoryBase}\\${soundFile.trim()}`;
    const soundBuffer = await this.#getSound(soundPath);

    audioSource.setBuffer(soundBuffer);

    audioSource.onEnded = () => {
      audioSource.isPlaying = false;

      if (onEnded) {
        onEnded();
      }
    };

    audioSource.play();
  }

  async #loadDbs() {
    this.#zoneMusicDb = await this.#dbManager.get('ZoneMusic.dbc', ZoneMusicRecord);
    this.#soundEntriesDb = await this.#dbManager.get('SoundEntries.dbc', SoundEntriesRecord);
  }

  async #syncZoneMusic() {
    if (!this.#zoneMusicDb || !this.#soundEntriesDb) {
      requestAnimationFrame(() => this.#syncZoneMusic().catch((error) => console.error(error)));
      return;
    }

    if (this.#desiredZoneMusicId !== this.#currentZoneMusicId) {
      await this.#updateZoneMusic(this.#desiredZoneMusicId);
    }

    requestAnimationFrame(() => this.#syncZoneMusic().catch((error) => console.error(error)));
  }

  async #updateZoneMusic(zoneMusicId: number) {
    if (this.#currentZoneMusicId === zoneMusicId) {
      return;
    }

    const musicRecord = this.#zoneMusicDb.getRecord(zoneMusicId);

    // No matching ZoneMusicRecord found in client db
    if (!musicRecord) {
      this.#currentZoneMusicId = zoneMusicId;

      this.#zoneMusic.clear();

      return;
    }

    const soundRecords = musicRecord.sounds.map((soundEntriesId) =>
      this.#soundEntriesDb.getRecord(soundEntriesId),
    );

    this.#zoneMusic.set(musicRecord, soundRecords);

    this.#currentZoneMusicId = zoneMusicId;
  }

  #getSound(path: string): Promise<AudioBuffer> {
    const refId = normalizePath(path);

    const loaded = this.#loadedSounds.get(refId);
    if (loaded) {
      return Promise.resolve(loaded);
    }

    const alreadyLoading = this.#loadingSounds.get(refId);
    if (alreadyLoading) {
      return alreadyLoading;
    }

    const loading = this.#loadSound(refId, path);
    this.#loadingSounds.set(refId, loading);

    return loading;
  }

  async #loadSound(refId: string, path: string) {
    let buffer: AudioBuffer;
    try {
      const data = await loadAsset(this.#host, path);
      buffer = await this.#decodingContext.decodeAudioData(data);

      this.#loadedSounds.set(refId, buffer);
    } finally {
      this.#loadingSounds.delete(refId);
    }

    return buffer;
  }
}

export default SoundManager;
export { SoundManager };
