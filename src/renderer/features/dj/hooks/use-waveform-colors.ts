import { WaveformColors } from '/@/renderer/features/dj/utils/draw-waveform';
import { useLocalStorage } from '/@/shared/hooks/use-local-storage';

// Subbox-only: 3-band, RGB or Blue for the DJ waveform (subbox-app#268). A display
// preference, so it stays on this device, as the key notation does. 3-band by default,
// the look the waveform had before there was a choice.
export const useWaveformColors = () =>
    useLocalStorage<WaveformColors>({ defaultValue: 'bands', key: 'dj_waveform_colors' });
