import type { ThemeSystem } from '@divypandya/time-aware-theme';
import blossom from '@divypandya/time-aware-theme/presets/blossom';
import contrastFirst from '@divypandya/time-aware-theme/presets/contrast-first';
import dawnToDusk from '@divypandya/time-aware-theme/presets/dawn-to-dusk';
import ember from '@divypandya/time-aware-theme/presets/ember';
import forest from '@divypandya/time-aware-theme/presets/forest';
import meridian from '@divypandya/time-aware-theme/presets/meridian';
import nocturne from '@divypandya/time-aware-theme/presets/nocturne';
import paper from '@divypandya/time-aware-theme/presets/paper';
import slate from '@divypandya/time-aware-theme/presets/slate';
import tidal from '@divypandya/time-aware-theme/presets/tidal';

export interface PresetEntry {
  readonly id: string;
  readonly label: string;
  readonly note: string;
  readonly level: 'AA' | 'AAA';
  /** Widest background step at the switch, in OKLCH lightness. */
  readonly step: number;
  readonly system: ThemeSystem;
}

/**
 * Every preset, imported by its own subpath.
 *
 * This app is the exception that pulls in all ten so they can be compared. A
 * real one takes a single import and ships a single schedule, which is why the
 * presets are separate entry points rather than one barrel.
 */
export const presets: readonly PresetEntry[] = [
  {
    id: 'dawn-to-dusk',
    label: 'Dawn to dusk',
    note: 'Warm arc — indigo night, amber sunrise, ember dusk',
    level: 'AA',
    step: 0.038,
    system: dawnToDusk
  },
  {
    id: 'tidal',
    label: 'Tidal',
    note: 'Cool arc — cyan through slate, no warm hues',
    level: 'AA',
    step: 0.032,
    system: tidal
  },
  {
    id: 'paper',
    label: 'Paper',
    note: 'Near-achromatic surfaces, one chromatic accent',
    level: 'AA',
    step: 0.032,
    system: paper
  },
  {
    id: 'contrast-first',
    label: 'Contrast first',
    note: '7:1 everywhere; time carried by hue, not lightness',
    level: 'AAA',
    step: 0.265,
    system: contrastFirst
  },
  {
    id: 'nocturne',
    label: 'Nocturne',
    note: 'Eye-comforting — warm dim night, softer midday',
    level: 'AA',
    step: 0.025,
    system: nocturne
  },
  {
    id: 'ember',
    label: 'Ember',
    note: 'Deep amber throughout; lamplight rather than daylight',
    level: 'AA',
    step: 0.036,
    system: ember
  },
  {
    id: 'forest',
    label: 'Forest',
    note: 'Muted green and moss, low chroma',
    level: 'AA',
    step: 0.032,
    system: forest
  },
  {
    id: 'meridian',
    label: 'Meridian',
    note: 'Neutral and quiet; hue barely moves, only the light does',
    level: 'AA',
    step: 0.032,
    system: meridian
  },
  {
    id: 'blossom',
    label: 'Blossom',
    note: 'Soft rose and plum; lightest by day, tinted at night',
    level: 'AA',
    step: 0.032,
    system: blossom
  },
  {
    id: 'slate',
    label: 'Slate',
    note: 'Cool blue-grey, restrained accent, for dense interfaces',
    level: 'AA',
    step: 0.032,
    system: slate
  }
];

export function presetById(id: string): PresetEntry {
  const found = presets.find((entry) => entry.id === id) ?? presets[0];
  if (!found) {
    throw new Error('No presets are available.');
  }
  return found;
}
