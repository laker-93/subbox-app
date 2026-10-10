import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import i18n from '/@/i18n/i18n';
import { PymixController } from '/@/renderer/api/pymix/pymix-controller';
import { queryKeys } from '/@/renderer/api/query-keys';
import { useIsDemoSession } from '/@/renderer/config/demo-config';
import { urlConfig } from '/@/renderer/config/url-config';
import { useCurrentServerId } from '/@/renderer/store';
import { UserSettings } from '/@/shared/api/pymix/pymix-types';
import { toast } from '/@/shared/components/toast/toast';
import { useLocalStorage } from '/@/shared/hooks/use-local-storage';

// Subbox-only: DJ mode (subbox-app#236, design-dj-ui §5.7). Every DJ surface asks
// `useDjMode().enabled` and nothing else, so the gating lives here. The mode only hides
// surfaces: imports, exports and what the server computes are the same either way.

const OFF: UserSettings = { dj_mode: false, dj_mode_offered: false };

export const useDjMode = () => {
    const queryClient = useQueryClient();
    const serverId = useCurrentServerId();
    const isDemo = useIsDemoSession();
    const queryKey = queryKeys.userSettings.root(serverId);

    // `demo` is one login shared by every trial visitor, so pymix refuses to store its
    // settings (403): its choice stays on this device. A pymix without the route (null)
    // gets the same treatment, so the switch still works against it.
    const query = useQuery({
        enabled: Boolean(serverId) && !isDemo,
        queryFn: ({ signal }) =>
            PymixController.getUserSettings({ baseUrl: urlConfig.pymix, signal }),
        queryKey,
        staleTime: Infinity,
    });
    const onDevice = isDemo || query.data === null;
    const [deviceSettings, setDeviceSettings] = useLocalStorage<UserSettings>({
        defaultValue: OFF,
        key: `dj_mode:${serverId || 'local'}`,
    });

    const mutation = useMutation<
        UserSettings,
        Error,
        Partial<UserSettings>,
        { previous: null | undefined | UserSettings }
    >({
        mutationFn: (body: Partial<UserSettings>) =>
            PymixController.updateUserSettings({ baseUrl: urlConfig.pymix, body }),
        onError: (_err, _body, context) => {
            queryClient.setQueryData(queryKey, context?.previous);
            toast.error({ message: i18n.t('page.djMode.saveFailed') as string });
        },
        onMutate: async (body) => {
            await queryClient.cancelQueries({ queryKey });
            const previous = queryClient.getQueryData<null | UserSettings>(queryKey);
            queryClient.setQueryData<UserSettings>(queryKey, { ...(previous ?? OFF), ...body });
            return { previous };
        },
        onSuccess: (settings) => queryClient.setQueryData(queryKey, settings),
    });

    const settings = (onDevice ? deviceSettings : query.data) ?? OFF;

    const update = useCallback(
        (body: Partial<UserSettings>) => {
            if (onDevice) {
                setDeviceSettings((current) => ({ ...current, ...body }));
            } else {
                mutation.mutate(body);
            }
        },
        [mutation, onDevice, setDeviceSettings],
    );

    return {
        enabled: settings.dj_mode,
        // Still asking the server: a surface that shows only in DJ mode stays hidden
        // until then, and the offer waits rather than showing to someone already on.
        isLoading: !onDevice && query.isPending,
        offered: settings.dj_mode_offered,
        // Showing the offer counts as making it, whatever the user does with it.
        setEnabled: (dj_mode: boolean) => update({ dj_mode, dj_mode_offered: true }),
        setOffered: () => update({ dj_mode_offered: true }),
    };
};
