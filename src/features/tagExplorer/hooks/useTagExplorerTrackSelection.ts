import { useCallback, useEffect, useRef, useState } from 'react';

import type { SubsonicSong } from '@/lib/api/subsonicTypes';
import { ownedEntityKey } from '@/lib/util/ownedEntityKey';

export type TagExplorerOwnedTrackRef = {
  serverId: string;
  trackId: string;
};

function refForSong(song: SubsonicSong): TagExplorerOwnedTrackRef | null {
  if (!song.serverId) return null;
  return {
    serverId: song.serverId,
    trackId: song.id,
  };
}

function refKey(ref: TagExplorerOwnedTrackRef): string {
  return ownedEntityKey({
    id: ref.trackId,
    serverId: ref.serverId,
  });
}

export function useTagExplorerTrackSelection(queryKey: string) {
  const [allMatching, setAllMatching] = useState(false);
  const [explicit, setExplicit] = useState<Map<string, TagExplorerOwnedTrackRef>>(
    () => new Map(),
  );
  const [exclusions, setExclusions] = useState<Set<string>>(
    () => new Set(),
  );
  const anchorRef = useRef<number | null>(null);

  const clear = useCallback(() => {
    setAllMatching(false);
    setExplicit(new Map());
    setExclusions(new Set());
    anchorRef.current = null;
  }, []);

  useEffect(() => {
    // A different tag query/mode is a different result universe.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    clear();
  }, [queryKey, clear]);

  const isSelected = useCallback((song: SubsonicSong): boolean => {
    const ref = refForSong(song);
    if (!ref) return false;
    const key = refKey(ref);
    return allMatching
      ? !exclusions.has(key)
      : explicit.has(key);
  }, [allMatching, exclusions, explicit]);

  const applySong = useCallback((
    map: Map<string, TagExplorerOwnedTrackRef>,
    excluded: Set<string>,
    song: SubsonicSong,
    selected: boolean,
  ) => {
    const ref = refForSong(song);
    if (!ref) return;
    const key = refKey(ref);
    if (allMatching) {
      if (selected) excluded.delete(key);
      else excluded.add(key);
    } else if (selected) {
      map.set(key, ref);
    } else {
      map.delete(key);
    }
  }, [allMatching]);

  const toggle = useCallback((
    songs: readonly SubsonicSong[],
    rowIndex: number,
    shift: boolean,
  ) => {
    const clicked = songs[rowIndex];
    if (!clicked) return;
    const nextSelected = !isSelected(clicked);
    const start = shift && anchorRef.current != null
      ? Math.min(anchorRef.current, rowIndex)
      : rowIndex;
    const end = shift && anchorRef.current != null
      ? Math.max(anchorRef.current, rowIndex)
      : rowIndex;

    const nextExplicit = new Map(explicit);
    const nextExclusions = new Set(exclusions);
    for (let index = start; index <= end; index += 1) {
      const song = songs[index];
      if (song) {
        applySong(nextExplicit, nextExclusions, song, nextSelected);
      }
    }

    if (allMatching) setExclusions(nextExclusions);
    else setExplicit(nextExplicit);

    if (!shift || anchorRef.current == null) {
      anchorRef.current = rowIndex;
    }
  }, [
    allMatching,
    applySong,
    exclusions,
    explicit,
    isSelected,
  ]);

  const selectAllMatching = useCallback(() => {
    setAllMatching(true);
    setExplicit(new Map());
    setExclusions(new Set());
    anchorRef.current = null;
  }, []);

  const selectedCount = useCallback((total: number | null): number => {
    if (allMatching) {
      return total == null
        ? 0
        : Math.max(0, total - exclusions.size);
    }
    return explicit.size;
  }, [allMatching, exclusions.size, explicit.size]);

  return {
    allMatching,
    exclusions,
    explicitRefs: [...explicit.values()],
    hasSelection: allMatching || explicit.size > 0,
    isSelected,
    toggle,
    selectAllMatching,
    selectedCount,
    clear,
  };
}

export function tagExplorerTrackRefKey(
  ref: TagExplorerOwnedTrackRef,
): string {
  return refKey(ref);
}
