import { useLegalLinks } from '/@/renderer/features/shared/hooks/use-legal-links';
import { Group } from '/@/shared/components/group/group';
import { Text } from '/@/shared/components/text/text';

/**
 * The terms, privacy notice and reporting route have to be reachable before a user
 * has an account — that is most of the point of publishing them — so they are linked
 * from the auth modal as well as from Settings → About. The landing page renders the
 * same list through its own link styling rather than mounting this component.
 */
export const LegalFooterLinks = () => {
    const links = useLegalLinks();

    return (
        <Group gap="md" justify="center">
            {links.map((link) => (
                <Text
                    component="a"
                    href={link.href}
                    isLink
                    isMuted
                    key={link.href}
                    rel="noopener noreferrer"
                    size="xs"
                    target="_blank"
                >
                    {link.label}
                </Text>
            ))}
        </Group>
    );
};
