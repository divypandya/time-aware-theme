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
  readonly system: ThemeSystem;
}

// Every preset imported by its own subpath, which is how they are meant to be
// consumed. This app is the exception that pulls in all ten: a real one takes
// a single import and ships a single schedule.
export const presets: readonly PresetEntry[] = [
  {
    id: 'dawn-to-dusk',
    label: 'Dawn to dusk',
    note: 'Warm arc',
    system: dawnToDusk
  },
  { id: 'tidal', label: 'Tidal', note: 'Cool arc', system: tidal },
  { id: 'paper', label: 'Paper', note: 'Near-achromatic', system: paper },
  {
    id: 'contrast-first',
    label: 'Contrast first',
    note: 'AAA everywhere',
    system: contrastFirst
  },
  {
    id: 'nocturne',
    label: 'Nocturne',
    note: 'Eye-comforting',
    system: nocturne
  },
  { id: 'ember', label: 'Ember', note: 'Lamplight', system: ember },
  { id: 'forest', label: 'Forest', note: 'Muted green', system: forest },
  { id: 'meridian', label: 'Meridian', note: 'Neutral', system: meridian },
  { id: 'blossom', label: 'Blossom', note: 'Rose and plum', system: blossom },
  { id: 'slate', label: 'Slate', note: 'Cool blue-grey', system: slate }
];
