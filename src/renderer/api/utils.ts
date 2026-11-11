import { queryClient } from '/@/renderer/lib/react-query';
import { useAuthStore } from '/@/renderer/store';
import { toast } from '/@/shared/components/toast/toast';
import { ServerListItem } from '/@/shared/types/types';

export const authenticationFailure = (currentServer: null | ServerListItem) => {
    toast.error({
        message: 'Your session has expired.',
    });

    if (currentServer) {
        const serverId = currentServer.id;
        const token = currentServer.ndCredential;
        console.error(`token is expired: ${token}`);
        useAuthStore.getState().actions.updateServer(serverId, { ndCredential: undefined });
        useAuthStore.getState().actions.setCurrentServer(null);
    }

    // Stop what the dead session still had in flight. Without this, react-query kept
    // retrying the page's queries after the logout (~30 requests, each a 401, over
    // the next ~10s: subbox-app#319).
    queryClient.cancelQueries();
};
