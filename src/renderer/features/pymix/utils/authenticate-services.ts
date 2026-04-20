import { nanoid } from 'nanoid/non-secure';

import { api } from '/@/renderer/api';
import { FilebrowserController } from '/@/renderer/api/filebrowser/filebrowser-controller';
import { getNavidromeUrl, urlConfig } from '/@/renderer/config/url-config';
import { ServerListItemWithCredential } from '/@/shared/types/domain-types';
import { ServerType } from '/@/shared/types/types';

/**
 * Authenticates with navidrome and filebrowser using the given credentials,
 * then returns a fully-formed server item ready for the auth store.
 */
export const authenticateServices = async (args: {
    password: string;
    username: string;
}): Promise<ServerListItemWithCredential> => {
    const { password, username } = args;

    const navidromeUrl = getNavidromeUrl(username);

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
        id: nanoid(),
        isAdmin: authData.isAdmin,
        name: username,
        ndCredential: authData.ndCredential,
        type: ServerType.NAVIDROME,
        url: navidromeUrl,
        userId: authData.userId,
        username: authData.username,
    };
};
