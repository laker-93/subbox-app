import { Dispatch, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { Command, CommandPalettePages } from '/@/renderer/features/search/components/command';
import { useAuthStoreActions, useCurrentServer } from '/@/renderer/store';

interface ServerCommandsProps {
    handleClose: () => void;
    setPages: (pages: CommandPalettePages[]) => void;
    setQuery: Dispatch<string>;
}

export const ServerCommands = ({ handleClose, setPages, setQuery }: ServerCommandsProps) => {
    const { t } = useTranslation();
    const currentServer = useCurrentServer();
    const { deleteServer, setCurrentServer } = useAuthStoreActions();

    const handleLogOff = useCallback(() => {
        if (currentServer) {
            deleteServer(currentServer.id);
            setCurrentServer(null);
        }
        handleClose();
        setQuery('');
        setPages([CommandPalettePages.HOME]);
    }, [currentServer, deleteServer, handleClose, setCurrentServer, setPages, setQuery]);

    return (
        <>
            <Command.Group
                heading={t('common.account', { defaultValue: 'Account', postProcess: 'sentenceCase' })}
            >
                <Command.Item onSelect={handleLogOff}>
                    {t('page.appMenu.logOff', { postProcess: 'sentenceCase' })}
                </Command.Item>
            </Command.Group>
            <Command.Separator />
        </>
    );
};
