import { WaveformColors } from '/@/renderer/features/dj/utils/draw-waveform';
import { useLocalStorage } from '/@/shared/hooks/use-local-storage';

// Subbox-only: 3-band, RGB or Blue for the DJ waveform (subbox-app#268). A display
// preference, so it stays on this device, as the key notation does. Blue by default:
// it sits with the rest of subbox's blue theme.
export const useWaveformColors = () =>
    useLocalStorage<WaveformColors>({ defaultValue: 'blue', key: 'dj_waveform_colors' });
