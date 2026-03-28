import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PymixController } from '/@/renderer/api/pymix/pymix-controller';
import { authenticateServices } from '/@/renderer/features/pymix/utils/authenticate-services';
import { useAuthStoreActions } from '/@/renderer/store';
import { Button } from '/@/shared/components/button/button';
import { Modal, ModalProps } from '/@/shared/components/modal/modal';
import { PasswordInput } from '/@/shared/components/password-input/password-input';
import { Stack } from '/@/shared/components/stack/stack';
import { TextInput } from '/@/shared/components/text-input/text-input';
import { TextTitle } from '/@/shared/components/text-title/text-title';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';
import { useForm } from '/@/shared/hooks/use-form';

type AuthView = 'create' | 'login' | 'select';

interface PymixAuthModalProps {
    baseUrl: string;
    handlers: ModalProps['handlers'];
    initialView?: 'create' | 'login';
    opened: boolean;
    onSuccess: () => void;
}

export const PymixAuthModal = ({ baseUrl, handlers, initialView, onSuccess, opened }: PymixAuthModalProps) => {
    const [view, setView] = useState<AuthView>(initialView ?? 'select');

    return (
        <Modal handlers={handlers} opened={opened} size="xs" withCloseButton={false}>
            {view === 'select' && (
                <SelectView onCreateAccount={() => setView('create')} onLogin={() => setView('login')} />
            )}
            {view === 'login' && (
                <LoginView baseUrl={baseUrl} onSuccess={onSuccess} />
            )}
            {view === 'create' && (
                <CreateAccountView baseUrl={baseUrl} onSuccess={onSuccess} />
            )}
        </Modal>
    );
};

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

function LoginView({
    baseUrl,
    onSuccess,
}: {
    baseUrl: string;
    onSuccess: () => void;
}) {
    const { t } = useTranslation();
    const [isLoading, setIsLoading] = useState(false);
    const { addServer, setCurrentServer } = useAuthStoreActions();

    const form = useForm({
        initialValues: {
            password: '',
            username: '',
        },
    });

    const handleSubmit = form.onSubmit(async (values) => {
        try {
            setIsLoading(true);

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
                password: values.password,
                username: values.username,
            });

            addServer(serverItem);
            setCurrentServer(serverItem);

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
                        required
                        size="sm"
                        variant="filled"
                        {...form.getInputProps('password')}
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

function CreateAccountView({
    baseUrl,
    onSuccess,
}: {
    baseUrl: string;
    onSuccess: () => void;
}) {
    const { t } = useTranslation();
    const [isLoading, setIsLoading] = useState(false);
    const { addServer, setCurrentServer } = useAuthStoreActions();

    const form = useForm({
        initialValues: {
            email: '',
            password: '',
            token: '',
            username: '',
        },
    });

    const handleSubmit = form.onSubmit(async (values) => {
        try {
            setIsLoading(true);

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

            // 2. Authenticate with navidrome + filebrowser and set up server
            const serverItem = await authenticateServices({
                password: values.password,
                username: values.username,
            });

            addServer(serverItem);
            setCurrentServer(serverItem);

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

    const isSubmitDisabled =
        !form.values.username || !form.values.password || !form.values.email || !form.values.token;

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
                <Button
                    disabled={isSubmitDisabled}
                    fullWidth
                    loading={isLoading}
                    type="submit"
                    variant="filled"
                >
                    {t('common.create', { defaultValue: 'Create', postProcess: 'titleCase' })}{' '}
                    Account
                </Button>
            </Stack>
        </form>
    );
}
