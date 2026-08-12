import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

// The Subbox app icon — the same artwork electron-builder ships as the desktop
// icon (`assets/icons/icon.png`). `src/renderer/assets/icons/` still holds the
// upstream Feishin icons; don't import the logo from there.
import logo from '../../../../../assets/icons/512x512.png';
import styles from './landing-page.module.css';

import screenshot from '/@/renderer/assets/landing-library-preview.png';
import { urlConfig } from '/@/renderer/config/url-config';
import { openInviteRequest } from '/@/renderer/features/invite/store/invite-request-store';
import { useLegalLinks } from '/@/renderer/features/shared/hooks/use-legal-links';
import { Button } from '/@/shared/components/button/button';
import { Stack } from '/@/shared/components/stack/stack';
import { Tooltip } from '/@/shared/components/tooltip/tooltip';

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
    const legalLinks = useLegalLinks();

    return (
        <div className={styles['fs-landing-page-container']}>
            {/* Two columns from 900px up. Stacked, this page ran taller than most laptop
                viewports — and `body` is `overflow: hidden`, so everything below the fold
                was clipped with no way to scroll to it. */}
            <div className={styles['fs-landing-page-content']}>
                <div className={styles['fs-landing-page-copy']}>
                    <div className={styles['fs-landing-page-header']}>
                        {/* Decorative: the wordmark beside it already says "Sub-box". */}
                        <img alt="" className={styles['fs-landing-page-logo']} src={logo} />
                        <h1 className={styles['fs-landing-page-title']}>Sub-box</h1>
                    </div>

                    <p className={styles['fs-landing-page-tagline']}>
                        {/* No sentenceCase here: it lower-cases everything after the first
                            word, which turns "DJ library" into "dj library". */}
                        {t('page.landing.tagline', {
                            defaultValue: 'Your DJ library on any device.',
                        })}
                    </p>

                    {/* Three claims, each saying something the others don't. The previous
                        version also carried a paragraph and a fourth bullet that restated
                        "stream from the cloud, nothing to install" three times over. */}
                    <div className={styles['fs-landing-page-features']}>
                        <div className={styles['fs-landing-page-feature']}>
                            <span className={styles['fs-landing-page-feature-dot']} />
                            {t('page.landing.featureStreaming', {
                                defaultValue: 'Sync your collection to the cloud',
                            })}
                        </div>
                        <div className={styles['fs-landing-page-feature']}>
                            <span className={styles['fs-landing-page-feature-dot']} />
                            {t('page.landing.featureMetadata', {
                                defaultValue: 'Stream and manage from any device',
                            })}
                        </div>
                    </div>

                    {/* One primary action. Everything else is deliberately quieter: four
                        equal-weight buttons was choice paralysis at the exact moment we
                        want one obvious next step. */}
                    <Stack className={styles['fs-landing-page-enter-button']} gap="sm">
                        {onTryDemo ? (
                            <>
                                {/* The caveats live in a tooltip rather than a line of text
                                    under the button: they matter once you're considering the
                                    click, and as body copy they were just another row. */}
                                <Tooltip
                                    events={{ focus: true, hover: true, touch: true }}
                                    label={t('page.landing.tryDemoHint', {
                                        defaultValue:
                                            'explore a sample collection of license-free music.',
                                    })}
                                    openDelay={200}
                                    position="bottom"
                                    w={280}
                                >
                                    <Button
                                        fullWidth
                                        loading={demoLoading}
                                        onClick={onTryDemo}
                                        size="lg"
                                        variant="filled"
                                    >
                                        {t('page.landing.tryDemo', {
                                            defaultValue: 'demo',
                                            postProcess: 'titleCase',
                                        })}
                                    </Button>
                                </Tooltip>
                                <Button fullWidth onClick={onLogin} size="lg" variant="default">
                                    {t('common.login', {
                                        defaultValue: 'login',
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

                    {/* Grouped so the quiet lines read as one footer block rather than as
                        more rows competing for attention. */}
                    <div className={styles['fs-landing-page-footer']}>
                        <p className={styles['fs-landing-page-beta']}>
                            {t('page.landing.privateBeta', {
                                defaultValue: 'Sub-box is in private beta.',
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

                        {/* This is the only screen an unauthenticated visitor actually
                            reaches, so it is the one that has to carry the legal links —
                            a rightsholder or regulator must be able to find the terms and
                            the reporting route without an account. Their own row, quieter
                            than the account links above: required, not promoted. */}
                        <div className={styles['fs-landing-page-legal-links']}>
                            {legalLinks.map((link, index) => (
                                <Fragment key={link.href}>
                                    {index > 0 && (
                                        <span className={styles['fs-landing-page-link-separator']}>
                                            ·
                                        </span>
                                    )}
                                    <a
                                        className={styles['fs-landing-page-link']}
                                        href={link.href}
                                        rel="noopener noreferrer"
                                        target="_blank"
                                    >
                                        {link.label}
                                    </a>
                                </Fragment>
                            ))}
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
                            defaultValue:
                                'The Sub-box home screen in a browser, playlists in the sidebar and a track playing',
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
