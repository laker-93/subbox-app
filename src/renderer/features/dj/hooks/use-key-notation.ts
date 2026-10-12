import { KeyNotation } from '/@/renderer/features/dj/utils/musical-key';
import { useLocalStorage } from '/@/shared/hooks/use-local-storage';

// Subbox-only: Camelot, musical or both, for the Key column (subbox-app#240,
// design-dj-ui §10 Q4). A display preference, so it stays on this device: what's
// stored is one spelling either way (pymix#282). Both by default, as §5.3 draws it.
export const useKeyNotation = () =>
    useLocalStorage<KeyNotation>({ defaultValue: 'both', key: 'dj_key_notation' });
