import { DOMImplementation } from '@xmldom/xmldom';

const domImplementation = new DOMImplementation();
const doctype = domImplementation.createDocumentType('html', '', '');
const document = domImplementation.createDocument(null, 'html', doctype);

export function isElement(node: any): node is Element {
    return node.nodeType === document.ELEMENT_NODE;
}

/**
 * FOLDER
 */
export interface FolderAttributes {
    Count: string;
    Name: string;
    Type: '0';
}

export interface Folder extends Element {
    childNodes: NodeListOf<Folder | Playlist>;
    getAttribute<K extends keyof FolderAttributes>(attr: K): FolderAttributes[K];
    tagName: 'NODE';
}

export function isTrackReference(node: any): node is TrackReference {
    return isElement(node) && node.tagName === 'TRACK' && !!node.getAttribute('Key');
}

export function isPlaylist(node: any): node is Playlist {
    return (
        isElement(node) &&
        node.tagName === 'NODE' &&
        node.getAttribute('Type') === '1' &&
        Array.from(node.childNodes)
            .filter(isElement)
            .every((childNode) => isTrackReference(childNode))
    );
}

export function isFolder(node: any): node is Folder {
    return (
        isElement(node) &&
        node.tagName === 'NODE' &&
        node.getAttribute('Type') === '0' &&
        Array.from(node.childNodes)
            .filter(isElement)
            .every((childNode) => isFolder(childNode) || isPlaylist(childNode))
    );
}

/**
 * PLAYLIST
 */
export interface PlaylistAttributes {
    Entries: string;
    KeyType: string;
    Name: string;
    Type: '1';
}

export interface Playlist extends Element {
    childNodes: NodeListOf<Track>;
    getAttribute<K extends keyof PlaylistAttributes>(attr: K): PlaylistAttributes[K];
    tagName: 'NODE';
}

/**
 * TRACK
 */
export interface TrackAttributes {
    Album: string;
    Artist: string;
    AverageBpm: string;
    BitRate: string;
    Colour: string;
    Comments: string;
    Composer: string;
    DateAdded: string;
    DiscNumber: string;
    Genre: string;
    Grouping: string;
    Kind: string;
    Label: string;
    Location: string;
    Mix: string;
    Name: string;
    PlayCount: string;
    Rating: string;
    Remixer: string;
    SampleRate: string;
    Size: string;
    Tonality: string;
    TotalTime: string;
    TrackID: string;
    TrackNumber: string;
    Year: string;
}

export interface Track extends Element {
    childNodes: NodeListOf<Tempo>;
    getAttribute<K extends keyof TrackAttributes>(attr: K): TrackAttributes[K];
    tagName: 'TRACK';
}

export function isPositionMark(node: any): node is PositionMark {
    return isElement(node) && node.tagName === 'POSITION_MARK';
}

export function isTempo(node: any): node is Tempo {
    return isElement(node) && node.tagName === 'TEMPO';
}

export function isTrack(node: any): node is Track {
    return (
        isElement(node) &&
        node.tagName === 'TRACK' &&
        !!node.getAttribute('TrackID') &&
        Array.from(node.childNodes)
            .filter(isElement)
            .every((childNode) => isTempo(childNode) || isPositionMark(childNode))
    );
}

/**
 * TEMPO
 */
export interface TempoAttributes {
    Battito: string;
    Bpm: string;
    Inizio: string;
    Metro: string;
}

export interface Tempo extends Element {
    getAttribute<K extends keyof TempoAttributes>(attr: K): TempoAttributes[K];
    tagName: 'TEMPO';
}

/**
 * POSITION_MARK
 */
export interface PositionMarkAttributes {
    Blue: string;
    End: string;
    Green: string;
    Name: string;
    Num: string;
    Red: string;
    Start: string;
    Type: string;
}

export interface PositionMark extends Element {
    getAttribute<K extends keyof PositionMarkAttributes>(attr: K): PositionMarkAttributes[K];
    tagName: 'POSITION_MARK';
}

/**
 * TRACK_REFERENCE
 */
export interface TrackReferenceAttributes {
    Key: TrackAttributes['TrackID'];
}

export interface TrackReference extends Element {
    getAttribute<K extends keyof TrackReferenceAttributes>(
        attr: K,
    ): TrackReferenceAttributes[K];
    tagName: 'TRACK';
}
