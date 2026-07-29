import { nanoid } from 'nanoid/non-secure';

import { api } from '/@/renderer/api';
import { FilebrowserController } from '/@/renderer/api/filebrowser/filebrowser-controller';
import { getNavidromeUrl, urlConfig } from '/@/renderer/config/url-config';
import { ServerListItemWithCredential } from '/@/shared/types/domain-types';
import { ServerType } from '/@/shared/types/types';

// The public demo login is a restricted, non-admin Navidrome user living inside
// demoadmin's own container rather than a container of its own — 'demo' has no
// navidrome{demo} to resolve to, so its Navidrome URL is pinned to demoadmin's.
// Filebrowser is unaffected: 'demo' has its own (unscoped) Filebrowser account,
// since Filebrowser only matters for Sync -> Download, which requires a separate
// demoadmin pymix login anyway.
const DEMO_USERNAME = 'demo';
const DEMO_ACCOUNT_USERNAME = 'demoadmin';

/**
 * Authenticates with navidrome and filebrowser using the given credentials,
 * then returns a fully-formed server item ready for the auth store.
 */
export const authenticateServices = async (args: {
    /**
     * Reuse an existing server id (on re-login / token refresh) so the entry and
     * its saved password are updated in place instead of accumulating duplicates.
     */
    id?: string;
    password: string;
    username: string;
}): Promise<ServerListItemWithCredential> => {
    const { id, password, username } = args;
    const isDemo = username === DEMO_USERNAME;

    const navidromeUrl = getNavidromeUrl(isDemo ? DEMO_ACCOUNT_USERNAME : username);

    const [authData, fbToken] = await Promise.all([
        api.controller.authenticate(navidromeUrl, { password, username }, ServerType.NAVIDROME),
        FilebrowserController.authenticate({
            baseUrl: urlConfig.filebrowser,
            body: { password, username },
        }),
    ]);

    return {
        credential: authData.credential,
        fbToken,
        id: id ?? nanoid(),
        isAdmin: authData.isAdmin,
        name: username,
        ndCredential: authData.ndCredential,
        // Enables the navidrome 401 interceptor and the filebrowser reauth path to
        // silently refresh expired tokens (via the stored password) instead of
        // logging the user out. The password is persisted by the login flow.
        savePassword: true,
        type: ServerType.NAVIDROME,
        url: navidromeUrl,
        userId: authData.userId,
        username: authData.username,
    };
};
