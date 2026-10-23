import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';

import styles from './prep-panels.module.css';

import { DjEditor } from '/@/renderer/features/dj/hooks/use-dj-edit';
import { PAD_LETTERS } from '/@/renderer/features/dj/utils/dj-marks';
import { appName } from '/@/renderer/features/dj/utils/format-dj';
import { DjCue, DjLoop, DjTrack } from '/@/shared/api/pymix/pymix-types';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';

// Subbox-only: the prep view's history (subbox-app#241, design-dj-ui §3.2). Every
// version of the track's DJ data, newest first, with who wrote it and what it changed;
// revert writes any of them back as a new version. And when an import left a subbox
// edit alone (pymix#271), the value it brought, to take instead.

const MAX_SHOWN = 30;

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

/** `cue:2` -> `Cue C`, as the panels name them. */
const useFieldLabel = () => {
    const { t } = useTranslation();
    return (field: string) => {
        const [kind, slot] = field.split(':');
        if (kind === 'cue') return t('page.djPrep.fieldCue', { slot: PAD_LETTERS[+slot] ?? slot });
        if (kind === 'loop') {
            return t('page.djPrep.fieldLoop', { slot: PAD_LETTERS[+slot] ?? slot });
        }
        return (
            {
                bpm: t('page.djPrep.bpm'),
                grid: t('page.djPrep.grid'),
                'grid.locked': t('page.djPrep.fieldGridLock'),
                key: t('page.djPrep.fieldKey'),
                memory: t('page.djPrep.memoryCues'),
            }[field] ?? field
        );
    };
};

export const PrepHistory = ({ dj, editor }: { dj: DjTrack; editor: DjEditor }) => {
    const { t } = useTranslation();
    const fieldLabel = useFieldLabel();
    const versions = editor.history.data?.versions ?? [];

    const who = (changeType?: null | string, sourceApp?: null | string) => {
        if (changeType === 'revert') return t('page.djPrep.historyRevert');
        if (changeType === 'edit') return t('page.djPrep.historyEdit');
        return t('page.djPrep.historyImport', { app: appName(sourceApp) ?? sourceApp ?? '' });
    };

    return (
        <section aria-label={t('page.djPrep.history')} className={styles.panel}>
            <Group justify="space-between" mb="xs" wrap="nowrap">
                <Text fw={600} size="sm">
                    {t('page.djPrep.history')}
                </Text>
                <Group gap={4} wrap="nowrap">
                    <ActionIcon
                        aria-label={t('page.djPrep.undo')}
                        disabled={!editor.canUndo}
                        icon="undo"
                        onClick={editor.undo}
                        size="xs"
                        tooltip={{ label: t('page.djPrep.undoKey', { mod: MOD }) }}
                        variant="subtle"
                    />
                    <ActionIcon
                        aria-label={t('page.djPrep.redo')}
                        disabled={!editor.canRedo}
                        icon="redo"
                        onClick={editor.redo}
                        size="xs"
                        tooltip={{ label: t('page.djPrep.redoKey', { mod: MOD }) }}
                        variant="subtle"
                    />
                </Group>
            </Group>
            {versions.length === 0 && (
                <Text isMuted size="sm">
                    {editor.history.isPending ? '…' : t('page.djPrep.historyEmpty')}
                </Text>
            )}
            <Stack gap={2}>
                {versions.slice(0, MAX_SHOWN).map((v) => (
                    <Group className={styles.row} gap="sm" key={v.version} wrap="nowrap">
                        <Text className={styles.slot} isMuted size="xs">
                            {v.version}
                        </Text>
                        <Stack className={styles.name} gap={0}>
                            <Text size="sm" truncate>
                                {who(v.change_type, v.source_app)}
                            </Text>
                            <Text isMuted size="xs" truncate>
                                {[
                                    v.changed_at
                                        ? dayjs(v.changed_at * 1000).format('MMM D, HH:mm')
                                        : null,
                                    v.fields.map(fieldLabel).join(', ') || null,
                                ]
                                    .filter(Boolean)
                                    .join(' · ')}
                            </Text>
                        </Stack>
                        {v.version === dj.version ? (
                            <Text isMuted size="xs" w={52}>
                                {t('page.djPrep.historyCurrent')}
                            </Text>
                        ) : (
                            <Button
                                disabled={editor.pending}
                                onClick={() => editor.revert(v.version)}
                                size="compact-xs"
                                variant="subtle"
                                w={52}
                            >
                                {t('page.djPrep.revert')}
                            </Button>
                        )}
                    </Group>
                ))}
            </Stack>
        </section>
    );
};

/**
 * An import left these subbox edits alone; offer what it brought instead. Its
 * positions are in the importing app's time, so `restamp` moves them into the
 * edit's clock first. The grid comes with the grid editor (#245).
 */
export const KeptEdits = ({
    dj,
    editor,
    restamp,
}: {
    dj: DjTrack;
    editor: DjEditor;
    restamp: (ms: number, origin: null | string | undefined) => number;
}) => {
    const { t } = useTranslation();
    const fieldLabel = useFieldLabel();
    const incoming = dj.cuedata.import_incoming;
    if (!incoming) return null;
    const app = appName(incoming.source_app) ?? incoming.source_app;
    const origin = `import:${incoming.source_app}`;
    const theirs = incoming.cuedata as {
        cues?: DjCue[];
        key?: null | string;
        loops?: DjLoop[];
    };

    const take = (field: string) => {
        const [kind, slotText] = field.split(':');
        const slot = Number(slotText);
        if (kind === 'cue') {
            const cue = theirs.cues?.find((c) => c.index === slot);
            editor.apply({
                cue: {
                    slot,
                    value: cue
                        ? {
                              color: cue.color ?? undefined,
                              name: cue.name ?? undefined,
                              position: restamp(cue.position, origin),
                          }
                        : null,
                },
            });
        } else if (kind === 'loop') {
            const loop = theirs.loops?.find((l) => l.index === slot);
            editor.apply({
                loop: {
                    slot,
                    value: loop
                        ? {
                              active: loop.active ?? false,
                              color: loop.color ?? undefined,
                              end: restamp(loop.end, origin),
                              name: loop.name ?? undefined,
                              start: restamp(loop.start, origin),
                          }
                        : null,
                },
            });
        } else if (kind === 'key') {
            editor.apply({ key: { value: theirs.key ?? null } });
        }
    };
    // pymix keeps `import_incoming` until the next import, so a field already taken
    // (or edited to match) is left out: only what still differs is offered.
    const near = (a: number, b: number) => Math.abs(a - b) <= 1;
    const differs = (field: string) => {
        const [kind, slotText] = field.split(':');
        const slot = Number(slotText);
        if (kind === 'key') return (dj.cuedata.key ?? null) !== (theirs.key ?? null);
        if (kind === 'cue') {
            const mine = dj.cuedata.cues.find((c) => c.index === slot);
            const other = theirs.cues?.find((c) => c.index === slot);
            if (!mine || !other) return Boolean(mine) !== Boolean(other);
            return (
                !near(restamp(mine.position, mine.origin), restamp(other.position, origin)) ||
                (mine.name ?? '') !== (other.name ?? '') ||
                (mine.color ?? '').toUpperCase() !== (other.color ?? '').toUpperCase()
            );
        }
        if (kind === 'loop') {
            const mine = dj.cuedata.loops.find((l) => l.index === slot);
            const other = theirs.loops?.find((l) => l.index === slot);
            if (!mine || !other) return Boolean(mine) !== Boolean(other);
            return (
                !near(restamp(mine.start, mine.origin), restamp(other.start, origin)) ||
                !near(restamp(mine.end, mine.origin), restamp(other.end, origin)) ||
                (mine.name ?? '') !== (other.name ?? '')
            );
        }
        return false;
    };
    const takeable = incoming.fields.filter((f) => /^(cue|loop):\d+$|^key$/.test(f) && differs(f));
    if (takeable.length === 0) return null;

    return (
        <section aria-label={t('page.djPrep.keptTitle', { app })} className={styles.panel}>
            <Text fw={600} size="sm">
                {t('page.djPrep.keptTitle', { app })}
            </Text>
            <Text isMuted mb="xs" size="sm">
                {t('page.djPrep.keptBody', { app })}
            </Text>
            <Stack gap={2}>
                {takeable.map((field) => (
                    <Group className={styles.row} gap="sm" key={field} wrap="nowrap">
                        <Text className={styles.name} size="sm">
                            {fieldLabel(field)}
                        </Text>
                        <Button
                            disabled={editor.pending}
                            onClick={() => take(field)}
                            size="compact-xs"
                            variant="default"
                        >
                            {t('page.djPrep.useTheirs', { app })}
                        </Button>
                    </Group>
                ))}
            </Stack>
        </section>
    );
};
