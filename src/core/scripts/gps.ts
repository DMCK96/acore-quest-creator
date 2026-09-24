import type { Position } from './model';

const round = (n: number): number => Math.round(n * 100) / 100;
const NUMBER = '(-?\\d+(?:\\.\\d+)?)';

/**
 * A position from the text the server prints for `.gps`, so authors can paste where they are
 * standing in game until the map viewer exists. Numbers are rounded to two decimals, which is
 * finer than anything a player can place by hand.
 */
export function parseGps(text: string): (Position & { map: number }) | null {
  const xyz = new RegExp(`X:\\s*${NUMBER}\\s+Y:\\s*${NUMBER}\\s+Z:\\s*${NUMBER}`).exec(text);
  if (!xyz) return null;
  const map = /Map:\s*(\d+)/.exec(text);
  const o = new RegExp(`Orientation:\\s*${NUMBER}`).exec(text);
  return {
    map: map ? Number(map[1]) : 0,
    x: round(Number(xyz[1])),
    y: round(Number(xyz[2])),
    z: round(Number(xyz[3])),
    o: o ? round(Number(o[1])) : 0,
  };
}
