import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import credits from '/@/renderer/features/settings/credits/music-credits.json';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';

/**
 * The demo library is Creative Commons licensed. CC BY, BY-SA and BY-ND all
 * require attribution wherever the work is made available, so this list is a
 * licence obligation rather than a courtesy — see scripts/build-credits.mjs.
 *
 * The modification notice below is part of that obligation, not a footnote:
 * part of the library is BY-ND, and every file carries an added `subbox_id`
 * metadata tag, so the page states plainly that the audio is untouched and only
 * metadata is written. Do not drop it when editing this component.
 */
const COLLAPSED_COUNT = 8;

export const MusicCreditsSettings = () => {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(false);

    const visible = useMemo(
        () => (expanded ? credits.tracks : credits.tracks.slice(0, COLLAPSED_COUNT)),
        [expanded],
    );

    const remaining = credits.tracks.length - COLLAPSED_COUNT;

    return (
        <Stack gap="md">
            <Stack gap="xs">
                <Text isNoSelect size="md">
                    {t('page.setting.musicCredits', { postProcess: 'sentenceCase' })}
                </Text>
                <Text isMuted size="sm">
                    {t('page.setting.musicCreditsDescription')}
                </Text>
                <Text isMuted size="sm">
                    {t('page.setting.musicCreditsModificationNotice')}
                </Text>
            </Stack>

            <Stack gap="sm" px="md">
                {visible.map((track) => (
                    <Group
                        gap="xs"
                        justify="space-between"
                        key={`${track.artist}-${track.title}`}
                        wrap="nowrap"
                    >
                        <Text overflow="hidden" size="sm">
                            <Text
                                component="a"
                                href={track.sourceUrl}
                                isLink
                                rel="noopener noreferrer"
                                size="sm"
                                target="_blank"
                            >
                                {track.title}
                            </Text>
                            {` - ${track.artist}`}
                        </Text>
                        <Text
                            component="a"
                            href={track.licenceUrl}
                            isLink
                            isMuted
                            rel="noopener noreferrer"
                            size="sm"
                            style={{ whiteSpace: 'nowrap' }}
                            target="_blank"
                        >
                            {track.licence}
                        </Text>
                    </Group>
                ))}
            </Stack>

            {remaining > 0 && (
                <Group justify="flex-start" px="md">
                    <Button
                        onClick={() => setExpanded((value) => !value)}
                        size="xs"
                        variant="subtle"
                    >
                        {expanded
                            ? t('page.setting.musicCreditsShowLess', {
                                  postProcess: 'sentenceCase',
                              })
                            : t('page.setting.musicCreditsShowAll', { count: remaining })}
                    </Button>
                </Group>
            )}
        </Stack>
    );
};
