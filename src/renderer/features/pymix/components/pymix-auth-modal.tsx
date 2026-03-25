import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PymixController } from '/@/renderer/api/pymix/pymix-controller';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
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
    opened: boolean;
    onSuccess: () => void;
}

export const PymixAuthModal = ({ baseUrl, handlers, onSuccess, opened }: PymixAuthModalProps) => {
    const [view, setView] = useState<AuthView>('select');

    const handleBack = () => setView('select');

    return (
        <Modal handlers={handlers} opened={opened} size="sm" title="Pymix Account">
            {view === 'select' && (
                <SelectView onCreateAccount={() => setView('create')} onLogin={() => setView('login')} />
            )}
            {view === 'login' && (
                <LoginView baseUrl={baseUrl} onBack={handleBack} onSuccess={onSuccess} />
            )}
            {view === 'create' && (
                <CreateAccountView baseUrl={baseUrl} onBack={handleBack} onSuccess={onSuccess} />
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
        <Stack gap="xl" p="md">
            <Stack align="center" gap="sm">
                <TextTitle order={3}>
                    {t('common.welcome', { defaultValue: 'Welcome', postProcess: 'sentenceCase' })}
                </TextTitle>
                <Text c="dimmed" size="sm" ta="center">
                    Login to an existing account or create a new one.
                </Text>
            </Stack>
            <Stack gap="md">
                <Button fullWidth onClick={onLogin} size="lg" variant="filled">
                    {t('common.login', { defaultValue: 'Login', postProcess: 'titleCase' })}
                </Button>
                <Button fullWidth onClick={onCreateAccount} size="lg" variant="default">
                    {t('common.create', { defaultValue: 'Create', postProcess: 'titleCase' })}{' '}
                    Account
                </Button>
            </Stack>
        </Stack>
    );
}

function LoginView({
    baseUrl,
    onBack,
    onSuccess,
}: {
    baseUrl: string;
    onBack: () => void;
    onSuccess: () => void;
}) {
    const { t } = useTranslation();
    const [isLoading, setIsLoading] = useState(false);

    const form = useForm({
        initialValues: {
            password: '',
            username: '',
        },
    });

    const handleSubmit = form.onSubmit(async (values) => {
        try {
            setIsLoading(true);
            await PymixController.login({
                baseUrl,
                body: {
                    password: values.password,
                    username: values.username,
                },
            });

            toast.success({
                message: t('common.success', {
                    defaultValue: 'Success',
                    postProcess: 'sentenceCase',
                }),
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
            <Stack gap="xl" p="md">
                <TextTitle order={3}>
                    {t('common.login', { defaultValue: 'Login', postProcess: 'titleCase' })}
                </TextTitle>
                <Stack gap="md">
                    <TextInput
                        data-autofocus
                        label={t('form.addServer.input', {
                            context: 'username',
                            postProcess: 'titleCase',
                        })}
                        required
                        variant="filled"
                        {...form.getInputProps('username')}
                    />
                    <PasswordInput
                        label={t('form.addServer.input', {
                            context: 'password',
                            postProcess: 'titleCase',
                        })}
                        required
                        variant="filled"
                        {...form.getInputProps('password')}
                    />
                </Stack>
                <Group grow>
                    <Button onClick={onBack} variant="default">
                        {t('common.back', { defaultValue: 'Back', postProcess: 'titleCase' })}
                    </Button>
                    <Button
                        disabled={isSubmitDisabled}
                        loading={isLoading}
                        type="submit"
                        variant="filled"
                    >
                        {t('common.login', { defaultValue: 'Login', postProcess: 'titleCase' })}
                    </Button>
                </Group>
            </Stack>
        </form>
    );
}

function CreateAccountView({
    baseUrl,
    onBack,
    onSuccess,
}: {
    baseUrl: string;
    onBack: () => void;
    onSuccess: () => void;
}) {
    const { t } = useTranslation();
    const [isLoading, setIsLoading] = useState(false);

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
            await PymixController.create({
                baseUrl,
                body: {
                    email: values.email,
                    password: values.password,
                    token: values.token,
                    username: values.username,
                },
            });

            toast.success({
                message: t('common.success', {
                    defaultValue: 'Account created',
                    postProcess: 'sentenceCase',
                }),
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
            <Stack gap="xl" p="md">
                <TextTitle order={3}>
                    {t('common.create', { defaultValue: 'Create', postProcess: 'titleCase' })}{' '}
                    Account
                </TextTitle>
                <Stack gap="md">
                    <TextInput
                        data-autofocus
                        label={t('form.addServer.input', {
                            context: 'username',
                            postProcess: 'titleCase',
                        })}
                        required
                        variant="filled"
                        {...form.getInputProps('username')}
                    />
                    <TextInput
                        label="Email"
                        required
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
                        variant="filled"
                        {...form.getInputProps('password')}
                    />
                    <TextInput
                        label="Invite Token"
                        required
                        variant="filled"
                        {...form.getInputProps('token')}
                    />
                </Stack>
                <Group grow>
                    <Button onClick={onBack} variant="default">
                        {t('common.back', { defaultValue: 'Back', postProcess: 'titleCase' })}
                    </Button>
                    <Button
                        disabled={isSubmitDisabled}
                        loading={isLoading}
                        type="submit"
                        variant="filled"
                    >
                        {t('common.create', { defaultValue: 'Create', postProcess: 'titleCase' })}{' '}
                        Account
                    </Button>
                </Group>
            </Stack>
        </form>
    );
}
