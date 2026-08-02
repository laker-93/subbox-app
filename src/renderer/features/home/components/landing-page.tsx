import { useTranslation } from 'react-i18next';

import styles from './landing-page.module.css';

import { urlConfig } from '/@/renderer/config/url-config';
import { Button } from '/@/shared/components/button/button';
import { Stack } from '/@/shared/components/stack/stack';

interface LandingPageProps {
    /** Omitted when no demo account is configured for this build — the button then doesn't render. */
    demoLoading?: boolean;
    onCreateAccount: () => void;
    onLogin: () => void;
    onTryDemo?: () => void;
}

export const LandingPage = ({
    demoLoading,
    onCreateAccount,
    onLogin,
    onTryDemo,
}: LandingPageProps) => {
    const { t } = useTranslation();

    return (
        <div className={styles['fs-landing-page-container']}>
            <div className={styles['fs-landing-page-content']}>
                <h1 className={styles['fs-landing-page-title']}>Subbox</h1>
                <p className={styles['fs-landing-page-description']}>
                    {t('page.landing.description', {
                        defaultValue:
                            'A cloud-based music library management platform built for DJs. Upload, stream, sync, and manage your music collection across devices and DJ software.',
                        postProcess: 'sentenceCase',
                    })}
                </p>
                <div className={styles['fs-landing-page-features']}>
                    <div className={styles['fs-landing-page-feature']}>
                        <span className={styles['fs-landing-page-feature-dot']} />
                        {t('page.landing.featureCloudLibrary', {
                            defaultValue: 'Upload and store your music collection in the cloud',
                        })}
                    </div>
                    <div className={styles['fs-landing-page-feature']}>
                        <span className={styles['fs-landing-page-feature-dot']} />
                        {t('page.landing.featureSync', {
                            defaultValue:
                                'Sync and convert libraries between Serato, Rekordbox, and more',
                        })}
                    </div>
                    <div className={styles['fs-landing-page-feature']}>
                        <span className={styles['fs-landing-page-feature-dot']} />
                        {t('page.landing.featureMetadata', {
                            defaultValue: 'Manage cue points, loops, and playlists',
                        })}
                    </div>
                    <div className={styles['fs-landing-page-feature']}>
                        <span className={styles['fs-landing-page-feature-dot']} />
                        {t('page.landing.featureStreaming', {
                            defaultValue: 'Stream your library across desktop, web, and mobile',
                        })}
                    </div>
                </div>
                <Stack className={styles['fs-landing-page-enter-button']} gap="md">
                    <Button
                        component="a"
                        fullWidth
                        href={urlConfig.discord}
                        rel="noopener noreferrer"
                        size="lg"
                        style={{ border: '1px solid var(--theme-colors-primary)' }}
                        target="_blank"
                        variant="default"
                    >
                        {t('common.joinTheCommunity', {
                            defaultValue: 'Join the Community',
                            postProcess: 'titleCase',
                        })}
                    </Button>
                    {onTryDemo && (
                        <>
                            <Button
                                fullWidth
                                loading={demoLoading}
                                onClick={onTryDemo}
                                size="lg"
                                variant="filled"
                            >
                                {t('page.landing.tryDemo', {
                                    defaultValue: 'Try the demo',
                                    postProcess: 'titleCase',
                                })}
                            </Button>
                            <p className={styles['fs-landing-page-demo-hint']}>
                                {t('page.landing.tryDemoHint', {
                                    defaultValue:
                                        'No sign-up needed — explore a sample library instantly.',
                                })}
                            </p>
                        </>
                    )}
                    <Button
                        fullWidth
                        onClick={onLogin}
                        size="lg"
                        variant={onTryDemo ? 'default' : 'filled'}
                    >
                        {t('common.login', {
                            defaultValue: 'Login',
                            postProcess: 'titleCase',
                        })}
                    </Button>
                    <Button fullWidth onClick={onCreateAccount} size="lg" variant="default">
                        {t('page.landing.createAccount', {
                            defaultValue: 'Create account',
                            postProcess: 'titleCase',
                        })}
                    </Button>
                </Stack>
            </div>
        </div>
    );
};
