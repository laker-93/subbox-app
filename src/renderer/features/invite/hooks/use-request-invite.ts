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
 *
 * `retry: false` overrides the app-wide mutation default (3 retries in production).
 * Verified live: without this, one submit of a rejected address fired 4 requests
 * (~8s of exponential backoff) against pymix's `/invite-request`, which caps at 5/hour
 * per IP specifically so a real user correcting a typo never gets rate-limited — a
 * single mistyped address plus a retry storm burns nearly the whole budget before the
 * user gets to try their real one.
 */
export const useRequestInvite = () =>
    useMutation<unknown, Error, InviteRequestBody>({
        mutationFn: async (body) =>
            PymixController.requestInvite({ baseUrl: urlConfig.pymix, body }),
        retry: false,
    });
