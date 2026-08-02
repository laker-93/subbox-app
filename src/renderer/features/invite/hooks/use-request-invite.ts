import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';

import { PymixController } from '/@/renderer/api/pymix/pymix-controller';
import { urlConfig } from '/@/renderer/config/url-config';
import { pymixType } from '/@/shared/api/pymix/pymix-types';

export type InviteRequestBody = z.infer<typeof pymixType._parameters.inviteRequest>;

/**
 * Submit a beta-invite request.
 *
 * No query invalidation and no server id: the endpoint is unauthenticated and writes
 * nothing this client ever reads back, so there is no cache to keep honest. The error is
 * left to propagate as-is (a `PymixInviteRequestError`) rather than being toasted here —
 * the form renders an invalid address inline against the field, which a toast can't do.
 */
export const useRequestInvite = () =>
    useMutation<unknown, Error, InviteRequestBody>({
        mutationFn: async (body) =>
            PymixController.requestInvite({ baseUrl: urlConfig.pymix, body }),
    });
