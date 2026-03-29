import isElectron from 'is-electron';

import { SyncRekordbox } from '/@/renderer/features/sync/components/sync-rekordbox';
import { Center } from '/@/shared/components/center/center';
import { Text } from '/@/shared/components/text/text';

export const SyncModePlaceholder = () => {
    if (!isElectron()) {
        return (
            <Center style={{ height: '100%' }}>
                <Text>Sync</Text>
            </Center>
        );
    }

    return <SyncRekordbox />;
};
