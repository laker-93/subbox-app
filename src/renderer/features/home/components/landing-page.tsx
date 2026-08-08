import { useTranslation } from 'react-i18next';

import styles from './landing-page.module.css';

import logo from '/@/renderer/assets/icons/256x256.png';
import screenshot from '/@/renderer/assets/landing-library-preview.png';
import { urlConfig } from '/@/renderer/config/url-config';
import { openInviteRequest } from '/@/renderer/features/invite/store/invite-request-store';
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
            {/* Two columns from 900px up. Stacked, this page ran 946px tall — taller than
                most laptop viewports — and `body` is `overflow: hidden`, so everything
                below the fold was clipped with no way to scroll to it. */}
            <div className={styles['fs-landing-page-content']}>
                <div className={styles['fs-landing-page-copy']}>
                    <div className={styles['fs-landing-page-header']}>
                        {/* Decorative: the wordmark beside it already says "Subbox". */}
                        <img alt="" className={styles['fs-landing-page-logo']} src={logo} />
                        <h1 className={styles['fs-landing-page-title']}>Subbox</h1>
                    </div>

                    <p className={styles['fs-landing-page-description']}>
                        {/* No sentenceCase here: it lower-cases everything after the first
                            word, which turns "DJ library" into "dj library". */}
                        {t('page.landing.description', {
                            defaultValue:
                                'Your DJ library, everywhere. Subbox streams your whole collection from the cloud — in any browser, on any device, with nothing to install.',
                        })}
                    </p>

                    <div className={styles['fs-landing-page-features']}>
                        <div className={styles['fs-landing-page-feature']}>
                            <span className={styles['fs-landing-page-feature-dot']} />
                            {t('page.landing.featureStreaming', {
                                defaultValue:
                                    'Stream your library in a browser — desktop, laptop, phone, no install',
                            })}
                        </div>
                        <div className={styles['fs-landing-page-feature']}>
                            <span className={styles['fs-landing-page-feature-dot']} />
                            {t('page.landing.featureCloudLibrary', {
                                defaultValue:
                                    'Your whole collection stored in the cloud, backed up and always with you',
                            })}
                        </div>
                        <div className={styles['fs-landing-page-feature']}>
                            <span className={styles['fs-landing-page-feature-dot']} />
                            {t('page.landing.featureMetadata', {
                                defaultValue: 'Cue points, loops and playlists come with it',
                            })}
                        </div>
                        <div className={styles['fs-landing-page-feature']}>
                            <span className={styles['fs-landing-page-feature-dot']} />
                            {t('page.landing.featureSync', {
                                defaultValue: 'Reads and writes Rekordbox and Serato libraries',
                            })}
                        </div>
                    </div>

                    {/* One primary action. Everything else is deliberately quieter: four
                        equal-weight buttons was choice paralysis at the exact moment we
                        want one obvious next step. */}
                    <Stack className={styles['fs-landing-page-enter-button']} gap="sm">
                        {onTryDemo ? (
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
                                <Button fullWidth onClick={onLogin} size="md" variant="default">
                                    {t('common.login', {
                                        defaultValue: 'Login',
                                        postProcess: 'titleCase',
                                    })}
                                </Button>
                            </>
                        ) : (
                            // Desktop/self-hosted builds have no demo account, so Login is
                            // the primary action rather than leaving the page with none.
                            <Button fullWidth onClick={onLogin} size="lg" variant="filled">
                                {t('common.login', {
                                    defaultValue: 'Login',
                                    postProcess: 'titleCase',
                                })}
                            </Button>
                        )}
                    </Stack>

                    {/* Grouped so the three quiet lines read as one footer block rather
                        than three more competing rows. */}
                    <div className={styles['fs-landing-page-footer']}>
                        <p className={styles['fs-landing-page-beta']}>
                            {t('page.landing.privateBeta', {
                                defaultValue: 'Subbox is in private beta — spots are limited.',
                            })}{' '}
                            <button
                                className={styles['fs-landing-page-link']}
                                onClick={() => openInviteRequest('landing')}
                                type="button"
                            >
                                {t('page.invite.cta', {
                                    defaultValue: 'Request an invite',
                                    postProcess: 'sentenceCase',
                                })}
                            </button>
                        </p>

                        <div className={styles['fs-landing-page-secondary-links']}>
                            <button
                                className={styles['fs-landing-page-link']}
                                onClick={onCreateAccount}
                                type="button"
                            >
                                {t('page.landing.createAccount', {
                                    defaultValue: 'Create account',
                                    postProcess: 'sentenceCase',
                                })}
                            </button>
                            <span className={styles['fs-landing-page-link-separator']}>·</span>
                            {/* Demoted from the page's first and most prominent action: it
                                sent a first-time visitor off-site before they'd seen
                                anything. */}
                            <a
                                className={styles['fs-landing-page-link']}
                                href={urlConfig.discord}
                                rel="noopener noreferrer"
                                target="_blank"
                            >
                                {t('common.joinTheCommunity', {
                                    defaultValue: 'Join the community',
                                    postProcess: 'sentenceCase',
                                })}
                            </a>
                        </div>
                    </div>
                </div>

                {/* A single screenshot sells this better than the bullets do — a music app
                    whose landing page shows no product makes "Try the demo" a blind click.
                    Beside the copy on desktop; below the CTAs when stacked, so the buttons
                    stay above the fold on a phone. */}
                <div className={styles['fs-landing-page-preview']}>
                    <img
                        alt={t('page.landing.screenshotAlt', {
                            defaultValue: 'The Subbox library, streaming in the browser',
                        })}
                        className={styles['fs-landing-page-screenshot']}
                        loading="lazy"
                        src={screenshot}
                    />
                </div>
            </div>
        </div>
    );
};
