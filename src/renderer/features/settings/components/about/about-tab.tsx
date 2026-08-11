import { memo } from 'react';
import { Fragment } from 'react/jsx-runtime';

import { LicenceSettings } from '/@/renderer/features/settings/components/about/licence-settings';
import { MusicCreditsSettings } from '/@/renderer/features/settings/components/about/music-credits-settings';
import { Divider } from '/@/shared/components/divider/divider';
import { Stack } from '/@/shared/components/stack/stack';

const sections = [
    { component: LicenceSettings, key: 'licence' },
    { component: MusicCreditsSettings, key: 'music-credits' },
];

export const AboutTab = memo(() => {
    return (
        <Stack gap="md">
            {sections.map(({ component: Section, key }, index) => (
                <Fragment key={key}>
                    <Section />
                    {index < sections.length - 1 && <Divider />}
                </Fragment>
            ))}
        </Stack>
    );
});
