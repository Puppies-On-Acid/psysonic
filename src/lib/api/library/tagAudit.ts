/**
 * Explicitly invoked, read-only metadata coverage snapshot.
 * This does not start a library sync, trigger server reads or write tags.
 */
import { invoke } from '@tauri-apps/api/core';
import { mapServerIdFromIndexKey } from './internal';
import { mapScopePairs } from './scopeReads';
import type { LibraryScopePair } from './dto';

export type TagAuditStatus = 'complete' | 'partial' | 'missing';

export interface TagAuditAlbum {
  serverId: string;
  libraryId: string | null;
  albumId: string;
  name: string;
  artist: string | null;
  trackCount: number;
  genreTaggedTracks: number;
  moodTaggedTracks: number;
  albumGenreTagged: boolean;
  genreStatus: TagAuditStatus;
  moodStatus: TagAuditStatus;
}

export interface TagAuditSummary {
  albumsChecked: number;
  tracksChecked: number;
  genreMissing: number;
  genrePartial: number;
  moodMissing: number;
  moodPartial: number;
  missingBoth: number;
}

export interface TagAuditResponse {
  summary: TagAuditSummary;
  albums: TagAuditAlbum[];
}

export async function libraryTagAudit(
  scopes: LibraryScopePair[],
): Promise<TagAuditResponse> {
  if (scopes.length === 0) throw new Error('Select a library before running the audit.');
  const response = await invoke<TagAuditResponse>('library_tag_audit', {
    request: {
      scopes: mapScopePairs(scopes, scopes[0].serverId),
    },
  });
  return {
    ...response,
    albums: response.albums.map(album => ({
      ...album,
      serverId: mapServerIdFromIndexKey(album.serverId),
    })),
  };
}
