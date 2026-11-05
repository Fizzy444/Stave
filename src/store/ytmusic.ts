import { invoke } from '@tauri-apps/api/core';
import { Track } from './library';
import { getHighResThumbnail } from '../utils/thumbnail';

export interface YTTrackItem {
    id: string;
    title: string;
    artist: string;
    duration_secs: number;
    thumbnail_url: string | null;
}

export interface YTSection {
    title: string;
    items: YTTrackItem[];
}

export interface YTExploreData {
    sections: YTSection[];
}

export interface YTPlaylistDetails {
    id: string;
    title: string;
    author: string | null;
    description: string | null;
    thumbnail_url: string | null;
    track_count: number;
    tracks: YTTrackItem[];
}

export interface YTLibraryPlaylist {
    playlist_id: string;
    title: string;
    thumbnail_url: string | null;
    subtitle: string | null;
}

export async function searchYouTube(query: string, filter?: string): Promise<YTTrackItem[]> {
    return await invoke<YTTrackItem[]>('yt_search', { query, filter });
}

export async function getYouTubeExplore(): Promise<YTExploreData> {
    return await invoke<YTExploreData>('yt_get_explore');
}

export async function getYouTubeRadio(videoId: string): Promise<YTTrackItem[]> {
    return await invoke<YTTrackItem[]>('yt_get_radio', { videoId });
}

export async function getYouTubePlaylist(playlistId: string): Promise<YTPlaylistDetails> {
    return await invoke<YTPlaylistDetails>('yt_get_playlist', { playlistId });
}

export async function getYouTubeAccountPlaylists(): Promise<YTLibraryPlaylist[]> {
    return await invoke<YTLibraryPlaylist[]>('yt_get_account_playlists');
}

export async function getYouTubeStreamUrl(videoId: string): Promise<string> {
    return await invoke<string>('yt_get_stream_url', { videoId });
}

export function ytItemToTrack(item: YTTrackItem): Track {
    return {
        // Keep a string id so identity comparisons (`===`) and queue matching work.
        // Casting `yt_<videoId>` to a number produced NaN, which never equals
        // itself and broke "currently playing" highlighting and queue lookups.
        id: 'yt_' + item.id,
        path: 'yt:' + item.id,
        title: item.title,
        artist: item.artist,
        album_artist: item.artist,
        album: null,
        track_no: null,
        disc_no: null,
        duration_ms: item.duration_secs ? item.duration_secs * 1000 : null,
        art_hash: getHighResThumbnail(item.thumbnail_url) || (item.id ? `https://i.ytimg.com/vi/${item.id}/hq720.jpg` : null),
        accent: null,
        mtime: null,
        play_count: 0,
        last_played: null,
        favorite: false,
        source: 'youtube',
        youtube_id: item.id,
    } as unknown as Track;
}
