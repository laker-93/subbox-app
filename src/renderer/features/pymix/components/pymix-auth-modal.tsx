import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PymixController } from '/@/renderer/api/pymix/pymix-controller';
import { authenticateServices } from '/@/renderer/features/pymix/utils/authenticate-services';
import { useAuthStore, useAuthStoreActions } from '/@/renderer/store';
import { credentialStore } from '/@/renderer/utils/credential-store';
import { Button } from '/@/shared/components/button/button';
import { Checkbox } from '/@/shared/components/checkbox/checkbox';
import { Modal, ModalProps } from '/@/shared/components/modal/modal';
import { PasswordInput } from '/@/shared/components/password-input/password-input';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Stack } from '/@/shared/components/stack/stack';
import { TextInput } from '/@/shared/components/text-input/text-input';
import { TextTitle } from '/@/shared/components/text-title/text-title';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';
import { useForm } from '/@/shared/hooks/use-form';
import { ServerType } from '/@/shared/types/types';

type AuthView = 'create' | 'login' | 'select';

type CreateStatus = 'error' | 'idle' | 'loading' | 'success';

/**
 * Re-login should refresh the existing server entry instead of minting a new one,
 * otherwise stale, credential-stripped entries (and their saved passwords)
 * accumulate in the store. Match the prior entry for this user.
 */
const findExistingServerId = (username: string): string | undefined => {
    return Object.values(useAuthStore.getState().serverList).find(
        (server) => server.type === ServerType.NAVIDROME && server.username === username,
    )?.id;
};

/**
 * Persist the password so the filebrowser reauth path (and, on desktop, the
 * navidrome 401 interceptor) can silently refresh expired tokens. credentialStore
 * uses encrypted safeStorage on desktop and sessionStorage on web.
 */
const persistServerPassword = async (password: string, serverId: string): Promise<void> => {
    await credentialStore.set(password, serverId);
};

// "Remember me" controls whether the login form pre-fills saved credentials on the
// next login. It's independent of token reauth, which always keeps the password.
const REMEMBER_KEY = 'pymix_remember_credentials';

const getRememberPreference = (): boolean => localStorage.getItem(REMEMBER_KEY) !== 'false';

const setRememberPreference = (remember: boolean): void => {
    localStorage.setItem(REMEMBER_KEY, remember ? 'true' : 'false');
};

// The most recent saved server to pre-fill from (subbox is single-backend, so this
// is normally the only entry).
const findSavedServer = () =>
    Object.values(useAuthStore.getState().serverList).find(
        (server) => server.type === ServerType.NAVIDROME && server.username,
    );

interface PymixAuthModalProps {
    baseUrl: string;
    handlers: ModalProps['handlers'];
    initialView?: 'create' | 'login';
    onSuccess: () => void;
    opened: boolean;
}

export const PymixAuthModal = ({
    baseUrl,
    handlers,
    initialView,
    onSuccess,
    opened,
}: PymixAuthModalProps) => {
    const [view, setView] = useState<AuthView>(initialView ?? 'select');
    const [createStatus, setCreateStatus] = useState<CreateStatus>('idle');

    useEffect(() => {
        if (initialView) {
            setView(initialView);
        }
    }, [initialView]);

    const isBlocked = createStatus === 'loading';

    const blockedHandlers = {
        close: isBlocked ? () => {} : handlers.close,
        open: handlers.open,
        toggle: isBlocked ? () => {} : handlers.toggle,
    };

    return (
        <Modal
            closeOnClickOutside={!isBlocked}
            closeOnEscape={!isBlocked}
            handlers={blockedHandlers}
            opened={opened}
            size="xs"
            withCloseButton={false}
        >
            {view === 'select' && (
                <SelectView
                    onCreateAccount={() => setView('create')}
                    onLogin={() => setView('login')}
                />
            )}
            {view === 'login' && <LoginView baseUrl={baseUrl} onSuccess={onSuccess} />}
            {view === 'create' && (
                <CreateAccountView
                    baseUrl={baseUrl}
                    onStatusChange={setCreateStatus}
                    onSuccess={onSuccess}
                    status={createStatus}
                />
            )}
        </Modal>
    );
};

function CreateAccountView({
    baseUrl,
    onStatusChange,
    onSuccess,
    status,
}: {
    baseUrl: string;
    onStatusChange: (status: CreateStatus) => void;
    onSuccess: () => void;
    status: CreateStatus;
}) {
    const { t } = useTranslation();
    const [statusMessage, setStatusMessage] = useState('');
    const { addServer, setCurrentServer } = useAuthStoreActions();

    const form = useForm({
        initialValues: {
            email: '',
            password: '',
            token: '',
            username: '',
        },
        validate: {
            password: (value) =>
                value.length < 12
                    ? t('form.validation.minLength', {
                          count: 12,
                          defaultValue: 'Must be at least 12 characters',
                      })
                    : null,
        },
    });

    const handleSubmit = form.onSubmit(async (values) => {
        try {
            onStatusChange('loading');
            setStatusMessage(
                t('page.landing.creatingAccount', {
                    defaultValue: 'Creating your account. This may take a moment...',
                }),
            );

            // 1. Create pymix account
            await PymixController.create({
                baseUrl,
                body: {
                    email: values.email,
                    password: values.password,
                    token: values.token,
                    username: values.username,
                },
            });

            setStatusMessage(
                t('page.landing.settingUpServices', {
                    defaultValue: 'Setting up your services...',
                }),
            );

            // 2. Authenticate with navidrome + filebrowser and set up server
            // Retry up to 5 times with a 2s pause — the server may need a moment after account creation
            const MAX_LOGIN_ATTEMPTS = 5;
            let serverItem;
            for (let attempt = 1; attempt <= MAX_LOGIN_ATTEMPTS; attempt++) {
                try {
                    serverItem = await authenticateServices({
                        id: findExistingServerId(values.username),
                        password: values.password,
                        username: values.username,
                    });
                    break;
                } catch (loginErr) {
                    if (attempt === MAX_LOGIN_ATTEMPTS) {
                        throw loginErr;
                    }
                    await new Promise((resolve) => setTimeout(resolve, 2000));
                }
            }

            addServer(serverItem);
            setCurrentServer(serverItem);
            await persistServerPassword(values.password, serverItem.id);

            onStatusChange('success');
            setStatusMessage(
                t('page.landing.accountCreated', {
                    defaultValue: 'Account created successfully!',
                }),
            );

            toast.success({
                message: t('form.addServer.success', { postProcess: 'sentenceCase' }),
            });

            // Brief delay so user sees success before closing
            setTimeout(() => {
                onSuccess();
            }, 1000);
        } catch (err: any) {
            onStatusChange('error');
            setStatusMessage(
                err?.message ||
                    t('page.landing.accountError', {
                        defaultValue: 'Failed to create account. Please try again.',
                    }),
            );
        }
    });

    const isSubmitDisabled =
        !form.values.username || !form.values.password || !form.values.email || !form.values.token;

    if (status === 'loading' || status === 'success') {
        return (
            <Stack align="center" gap="md" p="xl">
                {status === 'loading' && <Spinner />}
                <Text c={status === 'success' ? 'green' : 'dimmed'} size="sm" ta="center">
                    {statusMessage}
                </Text>
            </Stack>
        );
    }

    if (status === 'error') {
        return (
            <Stack align="center" gap="md" p="xl">
                <Text c="red" size="sm" ta="center">
                    {statusMessage}
                </Text>
                <Button fullWidth onClick={() => onStatusChange('idle')} variant="default">
                    {t('common.tryAgain', {
                        defaultValue: 'Try again',
                        postProcess: 'sentenceCase',
                    })}
                </Button>
            </Stack>
        );
    }

    return (
        <form onSubmit={handleSubmit}>
            <Stack gap="md" p="md">
                <TextTitle order={4}>
                    {t('common.create', { defaultValue: 'Create', postProcess: 'titleCase' })}{' '}
                    Account
                </TextTitle>
                <Stack gap="sm">
                    <TextInput
                        data-autofocus
                        label={t('form.addServer.input', {
                            context: 'username',
                            postProcess: 'titleCase',
                        })}
                        required
                        size="sm"
                        variant="filled"
                        {...form.getInputProps('username')}
                    />
                    <TextInput
                        label="Email"
                        required
                        size="sm"
                        type="email"
                        variant="filled"
                        {...form.getInputProps('email')}
                    />
                    <PasswordInput
                        label={t('form.addServer.input', {
                            context: 'password',
                            postProcess: 'titleCase',
                        })}
                        minLength={12}
                        required
                        size="sm"
                        variant="filled"
                        {...form.getInputProps('password')}
                    />
                    <TextInput
                        label="Invite Token"
                        required
                        size="sm"
                        variant="filled"
                        {...form.getInputProps('token')}
                    />
                </Stack>
                <Button disabled={isSubmitDisabled} fullWidth type="submit" variant="filled">
                    {t('common.create', { defaultValue: 'Create', postProcess: 'titleCase' })}{' '}
                    Account
                </Button>
            </Stack>
        </form>
    );
}

function LoginView({ baseUrl, onSuccess }: { baseUrl: string; onSuccess: () => void }) {
    const { t } = useTranslation();
    const [isLoading, setIsLoading] = useState(false);
    const { addServer, setCurrentServer } = useAuthStoreActions();

    const form = useForm({
        initialValues: {
            password: '',
            rememberCredentials: getRememberPreference(),
            username: '',
        },
        validate: {
            password: (value) =>
                value.length < 12
                    ? t('form.validation.minLength', {
                          count: 12,
                          defaultValue: 'Must be at least 12 characters',
                      })
                    : null,
        },
    });

    // Pre-fill the saved credentials on mount so a logged-out user can log back in
    // without re-typing them. Only when "remember me" was left on.
    useEffect(() => {
        if (!getRememberPreference()) return;
        const saved = findSavedServer();
        if (!saved) return;

        let cancelled = false;
        credentialStore.get(saved.id).then((password) => {
            if (cancelled) return;
            form.setFieldValue('username', saved.username);
            if (password) form.setFieldValue('password', password);
        });

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleSubmit = form.onSubmit(async (values) => {
        try {
            setIsLoading(true);
            setRememberPreference(values.rememberCredentials);

            // 1. Authenticate with pymix
            await PymixController.login({
                baseUrl,
                body: {
                    password: values.password,
                    username: values.username,
                },
            });

            // 2. Authenticate with navidrome + filebrowser and set up server
            const serverItem = await authenticateServices({
                id: findExistingServerId(values.username),
                password: values.password,
                username: values.username,
            });

            addServer(serverItem);
            setCurrentServer(serverItem);
            await persistServerPassword(values.password, serverItem.id);

            toast.success({
                message: t('form.addServer.success', { postProcess: 'sentenceCase' }),
            });
            onSuccess();
        } catch (err: any) {
            toast.error({ message: err?.message });
        } finally {
            setIsLoading(false);
        }
    });

    const isSubmitDisabled = !form.values.username || !form.values.password;

    return (
        <form onSubmit={handleSubmit}>
            <Stack gap="md" p="md">
                <TextTitle order={4}>
                    {t('common.login', { defaultValue: 'Login', postProcess: 'titleCase' })}
                </TextTitle>
                <Stack gap="sm">
                    <TextInput
                        data-autofocus
                        label={t('form.addServer.input', {
                            context: 'username',
                            postProcess: 'titleCase',
                        })}
                        required
                        size="sm"
                        variant="filled"
                        {...form.getInputProps('username')}
                    />
                    <PasswordInput
                        label={t('form.addServer.input', {
                            context: 'password',
                            postProcess: 'titleCase',
                        })}
                        minLength={12}
                        required
                        size="sm"
                        variant="filled"
                        {...form.getInputProps('password')}
                    />
                    <Checkbox
                        label={t('common.rememberMe', {
                            defaultValue: 'Remember me',
                            postProcess: 'sentenceCase',
                        })}
                        {...form.getInputProps('rememberCredentials', { type: 'checkbox' })}
                    />
                </Stack>
                <Button
                    disabled={isSubmitDisabled}
                    fullWidth
                    loading={isLoading}
                    type="submit"
                    variant="filled"
                >
                    {t('common.login', { defaultValue: 'Login', postProcess: 'titleCase' })}
                </Button>
            </Stack>
        </form>
    );
}

function SelectView({
    onCreateAccount,
    onLogin,
}: {
    onCreateAccount: () => void;
    onLogin: () => void;
}) {
    const { t } = useTranslation();

    return (
        <Stack gap="lg" p="md">
            <Stack align="center" gap="xs">
                <TextTitle order={4}>
                    {t('common.welcome', { defaultValue: 'Welcome', postProcess: 'sentenceCase' })}
                </TextTitle>
                <Text c="dimmed" size="sm" ta="center">
                    Login to an existing account or create a new one.
                </Text>
            </Stack>
            <Stack gap="sm">
                <Button fullWidth onClick={onLogin} variant="filled">
                    {t('common.login', { defaultValue: 'Login', postProcess: 'titleCase' })}
                </Button>
                <Button fullWidth onClick={onCreateAccount} variant="default">
                    {t('common.create', { defaultValue: 'Create', postProcess: 'titleCase' })}{' '}
                    Account
                </Button>
            </Stack>
        </Stack>
    );
}
