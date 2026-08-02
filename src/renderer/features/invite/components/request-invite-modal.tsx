import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PymixInviteRequestError } from '/@/renderer/api/pymix/pymix-controller';
import {
    InviteRequestBody,
    useRequestInvite,
} from '/@/renderer/features/invite/hooks/use-request-invite';
import {
    InviteRequestSource,
    useInviteRequestActions,
    useInviteRequestOpened,
    useInviteRequestSource,
} from '/@/renderer/features/invite/store/invite-request-store';
import { Button } from '/@/shared/components/button/button';
import { Icon } from '/@/shared/components/icon/icon';
import { Modal } from '/@/shared/components/modal/modal';
import { Select } from '/@/shared/components/select/select';
import { Stack } from '/@/shared/components/stack/stack';
import { TextInput } from '/@/shared/components/text-input/text-input';
import { TextTitle } from '/@/shared/components/text-title/text-title';
import { Text } from '/@/shared/components/text/text';
import { useForm } from '/@/shared/hooks/use-form';

type DjSoftware = InviteRequestBody['dj_software'];

/**
 * The line that meets the user where they were. Everything below it is identical, but
 * the funnel only works if the first sentence acknowledges what they were just doing —
 * a locked upload and an idle banner click are very different moments.
 */
const useSourceIntro = (source: InviteRequestSource): string => {
    const { t } = useTranslation();

    switch (source) {
        case 'blockedAction':
            return t('page.invite.introBlockedAction', {
                defaultValue:
                    'Uploading your own music needs your own Subbox library — the demo is read-only.',
            });
        case 'createAccount':
            return t('page.invite.introCreateAccount', {
                defaultValue: "Don't have an invite token yet? Ask for one here.",
            });
        case 'demoBanner':
            return t('page.invite.introDemoBanner', {
                defaultValue:
                    'Liking the demo? Get your own library — upload your collection and stream it anywhere.',
            });
        default:
            return t('page.invite.introLanding', {
                defaultValue: 'Tell us where to send your invite when a spot opens up.',
            });
    }
};

export const RequestInviteModal = () => {
    const opened = useInviteRequestOpened();
    const source = useInviteRequestSource();
    const { closeInviteRequest } = useInviteRequestActions();

    const handlers = {
        close: closeInviteRequest,
        open: () => {},
        toggle: closeInviteRequest,
    };

    return (
        <Modal
            handlers={handlers}
            opened={opened}
            size="sm"
            withCloseButton={false}
            // Above Mantine's default modal layer (200), because this one is opened from
            // *inside* another modal — the Invite Token caption in Create Account. At the
            // same z-index the winner is whichever portal is later in the DOM, and this
            // modal loses: it mounts at app boot, while the auth modal's portal is only
            // created when it first opens. It rendered behind, unreachable.
            zIndex={400}
        >
            {/* Keyed on `opened` so each visit starts from a clean form rather than the
                previous submission's success or error state. */}
            <RequestInviteForm key={String(opened)} onDone={closeInviteRequest} source={source} />
        </Modal>
    );
};

function RequestInviteForm({
    onDone,
    source,
}: {
    onDone: () => void;
    source: InviteRequestSource;
}) {
    const { t } = useTranslation();
    const intro = useSourceIntro(source);
    const [submittedEmail, setSubmittedEmail] = useState<null | string>(null);
    const [formError, setFormError] = useState<null | string>(null);
    const { isPending, mutateAsync } = useRequestInvite();

    const form = useForm({
        initialValues: {
            djSoftware: 'rekordbox' as DjSoftware,
            djSoftwareOther: '',
            email: '',
        },
    });

    const isOther = form.values.djSoftware === 'other';

    const handleSubmit = form.onSubmit(async (values) => {
        setFormError(null);

        try {
            await mutateAsync({
                dj_software: values.djSoftware,
                dj_software_other: isOther ? values.djSoftwareOther.trim() || undefined : undefined,
                email: values.email.trim(),
            });
            setSubmittedEmail(values.email.trim());
        } catch (err) {
            const reason = err instanceof PymixInviteRequestError ? err.reason : 'failed';

            // A rejected address is the user's to fix, so it belongs on the field —
            // Mantine clears it again as soon as they start editing. The other two are
            // not their fault and have nothing to point at, so they sit by the button.
            if (reason === 'invalid') {
                form.setFieldError(
                    'email',
                    t('page.invite.errorInvalidEmail', {
                        defaultValue: "That doesn't look like a valid email address.",
                    }),
                );
            } else if (reason === 'rateLimited') {
                setFormError(
                    t('page.invite.errorRateLimited', {
                        defaultValue:
                            "That's a few requests in a short space of time — try again a bit later.",
                    }),
                );
            } else {
                setFormError(
                    t('page.invite.errorGeneric', {
                        defaultValue: "Couldn't send your request. Please try again.",
                    }),
                );
            }
        }
    });

    const handleClose = useCallback(() => onDone(), [onDone]);

    if (submittedEmail) {
        return (
            <Stack align="center" gap="md" p="md">
                <Icon color="success" icon="success" size="2.5rem" />
                <TextTitle order={4}>
                    {t('page.invite.successTitle', {
                        defaultValue: "You're on the list",
                        postProcess: 'sentenceCase',
                    })}
                </TextTitle>
                <Text c="dimmed" size="sm" ta="center">
                    {t('page.invite.successBody', {
                        defaultValue:
                            "We'll email {{email}} with an invite token when the next spot opens up. Keep exploring the demo in the meantime.",
                        email: submittedEmail,
                    })}
                </Text>
                <Button fullWidth onClick={handleClose} variant="filled">
                    {t('common.close', { defaultValue: 'Close', postProcess: 'titleCase' })}
                </Button>
            </Stack>
        );
    }

    return (
        <form onSubmit={handleSubmit}>
            <Stack gap="md" p="md">
                <Stack gap="xs">
                    <TextTitle order={4}>
                        {t('page.invite.title', {
                            defaultValue: 'Request an invite',
                            postProcess: 'sentenceCase',
                        })}
                    </TextTitle>
                    <Text c="dimmed" size="sm">
                        {intro}
                    </Text>
                </Stack>

                <Stack gap="sm">
                    <TextInput
                        data-autofocus
                        label={t('page.invite.emailLabel', {
                            defaultValue: 'Email',
                            postProcess: 'sentenceCase',
                        })}
                        required
                        size="sm"
                        type="email"
                        variant="filled"
                        {...form.getInputProps('email')}
                    />
                    <Select
                        data={[
                            { label: 'Rekordbox', value: 'rekordbox' },
                            { label: 'Serato', value: 'serato' },
                            {
                                label: t('page.invite.djSoftwareOther', {
                                    defaultValue: 'Something else',
                                    postProcess: 'sentenceCase',
                                }),
                                value: 'other',
                            },
                        ]}
                        // No sentenceCase — it would lower-case "DJ".
                        label={t('page.invite.djSoftwareLabel', {
                            defaultValue: 'What do you DJ on?',
                        })}
                        size="sm"
                        variant="filled"
                        {...form.getInputProps('djSoftware')}
                    />
                    {isOther && (
                        <TextInput
                            label={t('page.invite.djSoftwareOtherLabel', {
                                defaultValue: 'Which one?',
                                postProcess: 'sentenceCase',
                            })}
                            placeholder="Traktor, VirtualDJ, ..."
                            size="sm"
                            variant="filled"
                            {...form.getInputProps('djSoftwareOther')}
                        />
                    )}
                </Stack>

                <Stack gap="xs">
                    {formError && (
                        <Text c="red" size="sm">
                            {formError}
                        </Text>
                    )}
                    <Button
                        disabled={!form.values.email.trim()}
                        fullWidth
                        loading={isPending}
                        type="submit"
                        variant="filled"
                    >
                        {t('page.invite.submit', {
                            defaultValue: 'Request an invite',
                            postProcess: 'sentenceCase',
                        })}
                    </Button>
                    <Button fullWidth onClick={handleClose} variant="subtle">
                        {t('common.cancel', {
                            defaultValue: 'Cancel',
                            postProcess: 'titleCase',
                        })}
                    </Button>
                </Stack>
            </Stack>
        </form>
    );
}
