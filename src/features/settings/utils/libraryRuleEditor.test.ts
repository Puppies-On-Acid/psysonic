import { describe, expect, it } from 'vitest';
import { builtInMissingMetadataRule, MAX_LIBRARY_RULE_DEPTH, MAX_LIBRARY_RULE_NODES } from './libraryRuleModel';
import {
  appendLibraryRuleNode,
  canAppendLibraryRuleNode,
  changeLibraryRuleEntity,
  defaultLibraryRulePredicate,
  libraryRuleGroupAt,
  libraryRuleNodeCount,
  removeLibraryRuleNode,
  replaceLibraryRuleNode,
} from './libraryRuleEditor';

describe('Library Rules immutable condition builder actions', () => {
  it('starts from known valid defaults without mutating the original preset', () => {
    const album = builtInMissingMetadataRule('album');
    const original = JSON.stringify(album);
    expect(defaultLibraryRulePredicate('album')).toEqual({
      kind: 'predicate', field: 'albumName', operator: 'isPresent',
    });
    expect(defaultLibraryRulePredicate('track').field).toBe('trackArtist');
    const next = appendLibraryRuleNode(album, [], 'predicate');
    expect(libraryRuleNodeCount(next.root)).toBe(4);
    expect(JSON.stringify(album)).toBe(original);
    expect(next.root.children[2]).toEqual(defaultLibraryRulePredicate('album'));
  });

  it('adds nested ALL/ANY groups and updates a group without changing siblings', () => {
    const original = builtInMissingMetadataRule('album');
    const added = appendLibraryRuleNode(original, [], 'group');
    const child = libraryRuleGroupAt(added, [2]);
    expect(child?.combinator).toBe('all');
    const changed = replaceLibraryRuleNode(added, [2], {
      ...child!, combinator: 'any',
    });
    expect(libraryRuleGroupAt(changed, [2])?.combinator).toBe('any');
    expect(changed.root.children[0]).toEqual(original.root.children[0]);
    expect(libraryRuleGroupAt(added, [2])?.combinator).toBe('all');
  });

  it('removes nodes while protecting the root and a group's final condition', () => {
    const original = builtInMissingMetadataRule('album');
    expect(removeLibraryRuleNode(original, [])).toBe(original);
    const single = replaceLibraryRuleNode(original, [], {
      kind: 'group', combinator: 'all',
      children: [original.root.children[0]],
    });
    expect(removeLibraryRuleNode(single, [0])).toBe(single);
    const removed = removeLibraryRuleNode(original, [0]);
    expect(removed.root.children).toEqual([original.root.children[1]]);
    expect(original.root.children).toHaveLength(2);
  });

  it('blocks invalid paths, root replacement and excessive node/depth budgets', () => {
    const original = builtInMissingMetadataRule('album');
    expect(replaceLibraryRuleNode(original, [], defaultLibraryRulePredicate('album')))
      .toBe(original);
    expect(appendLibraryRuleNode(original, [99], 'group')).toBe(original);
    expect(removeLibraryRuleNode(original, [99])).toBe(original);
    let depth = original;
    let path: number[] = [];
    for (let i = 0; i < MAX_LIBRARY_RULE_DEPTH - 2; i += 1) {
      depth = appendLibraryRuleNode(depth, path, 'group');
      path = [...path, i === 0 ? 2 : 1];
    }
    expect(libraryRuleGroupAt(depth, path)).not.toBeNull();
    expect(canAppendLibraryRuleNode(depth, path, 'group')).toBe(false);

    let full = original;
    while (libraryRuleNodeCount(full.root) < MAX_LIBRARY_RULE_NODES) {
      full = appendLibraryRuleNode(full, [], 'predicate');
    }
    expect(canAppendLibraryRuleNode(full, [], 'predicate')).toBe(false);
    expect(appendLibraryRuleNode(full, [], 'predicate')).toBe(full);
  });

  it('changes entity by resetting incompatible fields to a valid track preset', () => {
    const album = builtInMissingMetadataRule('album');
    const track = changeLibraryRuleEntity(album, 'track');
    expect(track.entity).toBe('track');
    expect(track.root.children).toHaveLength(2);
    expect(changeLibraryRuleEntity(track, 'track')).toBe(track);
    expect(album.entity).toBe('album');
  });
});
