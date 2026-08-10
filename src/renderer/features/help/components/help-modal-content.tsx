import { useTranslation } from 'react-i18next';

import { Divider } from '/@/shared/components/divider/divider';
import { Stack } from '/@/shared/components/stack/stack';
import { TextTitle } from '/@/shared/components/text-title/text-title';
import { Text } from '/@/shared/components/text/text';

export const HelpModalContent = () => {
    const { t } = useTranslation();

    return (
        <Stack gap="lg" p="md">
            <Stack gap="xs">
                <TextTitle order={4}>
                    {t('page.help.gettingStarted', {
                        defaultValue: 'Getting started',
                        postProcess: 'sentenceCase',
                    })}
                </TextTitle>
                <Text c="dimmed" size="sm">
                    {t('page.help.gettingStartedDescription', {
                        defaultValue:
                            'Sub-box is a cloud-based music library management platform for DJs. After logging in, you can browse your music collection, manage playlists, and stream tracks.',
                    })}
                </Text>
            </Stack>
            <Divider />
            <Stack gap="xs">
                <TextTitle order={4}>
                    {t('page.help.sidebar', {
                        defaultValue: 'Sidebar',
                        postProcess: 'sentenceCase',
                    })}
                </TextTitle>
                <Text c="dimmed" size="sm">
                    {t('page.help.sidebarDescription', {
                        defaultValue:
                            'Use the sidebar to navigate between your library sections: albums, artists, playlists, genres, and folders. You can collapse or expand it from the menu.',
                    })}
                </Text>
            </Stack>
            <Divider />
            <Stack gap="xs">
                <TextTitle order={4}>
                    {t('page.help.search', {
                        defaultValue: 'Search & command palette',
                        postProcess: 'sentenceCase',
                    })}
                </TextTitle>
                <Text c="dimmed" size="sm">
                    {t('page.help.searchDescription', {
                        defaultValue:
                            'Press the search icon or use the command palette to quickly find tracks, albums, or artists. You can also use it to access app actions like settings or log off.',
                    })}
                </Text>
            </Stack>
            <Divider />
            <Stack gap="xs">
                <TextTitle order={4}>
                    {t('page.help.playback', {
                        defaultValue: 'Playback',
                        postProcess: 'sentenceCase',
                    })}
                </TextTitle>
                <Text c="dimmed" size="sm">
                    {t('page.help.playbackDescription', {
                        defaultValue:
                            'The player bar at the bottom controls playback. You can queue tracks, adjust volume, and view the current queue from the side panel.',
                    })}
                </Text>
            </Stack>
            <Divider />
            <Stack gap="xs">
                <TextTitle order={4}>
                    {t('page.help.settings', {
                        defaultValue: 'Settings',
                        postProcess: 'sentenceCase',
                    })}
                </TextTitle>
                <Text c="dimmed" size="sm">
                    {t('page.help.settingsDescription', {
                        defaultValue:
                            'Open settings from the menu to customise playback behaviour, appearance, and other preferences.',
                    })}
                </Text>
            </Stack>
        </Stack>
    );
};
