import { describe, expect, it } from 'vitest';
import {
  builtInMissingMetadataRule,
  LIBRARY_RULE_FIELDS,
  libraryRuleFieldsFor,
  libraryRuleOperatorsFor,
  MAX_LIBRARY_RULE_DEPTH,
  MAX_LIBRARY_RULE_NODES,
  validateLibraryRuleDocument,
  type LibraryRuleDocument,
  type LibraryRuleGroup,
} from './libraryRuleModel';

const album = (): LibraryRuleDocument => builtInMissingMetadataRule('album');
const codes = (doc: unknown) => validateLibraryRuleDocument(doc).map(issue => issue.code);

describe('Library Rules Stage 1 document contract', () => {
  it('provides a valid album preset with the same incomplete-tag selection as v1', () => {
    const doc = album();
    expect(validateLibraryRuleDocument(doc)).toEqual([]);
    expect(doc.root).toEqual({
      kind: 'group', combinator: 'any',
      children: [
        { kind: 'predicate', field: 'genreStatus', operator: 'isNot', value: 'complete' },
        { kind: 'predicate', field: 'moodStatus', operator: 'isNot', value: 'complete' },
      ],
    });
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc);
  });

  it('provides a valid track preset using track-level genre/mood presence', () => {
    const doc = builtInMissingMetadataRule('track');
    expect(validateLibraryRuleDocument(doc)).toEqual([]);
    expect(doc.root.children).toEqual([
      { kind: 'predicate', field: 'genrePresent', operator: 'is', value: false },
      { kind: 'predicate', field: 'moodPresent', operator: 'is', value: false },
    ]);
  });

  it('supports nested ALL/ANY combining different typed fields', () => {
    const doc = album();
    doc.root = {
      kind: 'group', combinator: 'all',
      children: [
        { kind: 'predicate', field: 'trackCount', operator: 'atLeast', value: 6 },
        { kind: 'group', combinator: 'any', children: [
          { kind: 'predicate', field: 'genreStatus', operator: 'is', value: 'partial' },
          { kind: 'predicate', field: 'albumYear', operator: 'isMissing' },
          { kind: 'predicate', field: 'albumName', operator: 'contains', value: 'Live' },
        ] },
      ],
    };
    expect(validateLibraryRuleDocument(doc)).toEqual([]);
  });

  it('only advertises the explicit entity-specific field registry and operators', () => {
    expect(libraryRuleFieldsFor('album')).toBe(LIBRARY_RULE_FIELDS.album);
    expect(libraryRuleFieldsFor('track')).toBe(LIBRARY_RULE_FIELDS.track);
    const status = LIBRARY_RULE_FIELDS.album.find(field => field.key === 'genreStatus');
    const track = LIBRARY_RULE_FIELDS.track.find(field => field.key === 'genrePresent');
    expect(status && libraryRuleOperatorsFor(status)).toEqual(['is', 'isNot']);
    expect(track && libraryRuleOperatorsFor(track)).toEqual(['is', 'isNot']);
    expect(LIBRARY_RULE_FIELDS.track.some(field => field.key === 'albumYear')).toBe(false);
  });

  it('rejects unknown fields, unsupported operators and cross-entity names', () => {
    const doc = album();
    doc.root.children = [{ kind: 'predicate', field: 'trackTitle', operator: 'is', value: 'x' }];
    expect(codes(doc)).toContain('unknown_field');
    doc.root.children = [{ kind: 'predicate', field: 'genreStatus', operator: 'contains', value: 'x' }];
    expect(codes(doc)).toContain('unsupported_operator');
    doc.root.children = [{ kind: 'predicate', field: '__proto__', operator: 'is', value: 'x' }];
    expect(codes(doc)).toContain('unknown_field');
  });

  it('validates typed values, absent values and presence operators', () => {
    const doc = album();
    doc.root.children = [{ kind: 'predicate', field: 'trackCount', operator: 'atLeast', value: '5' }];
    expect(codes(doc)).toContain('invalid_value');
    doc.root.children = [{ kind: 'predicate', field: 'trackCount', operator: 'atLeast' }];
    expect(codes(doc)).toContain('missing_value');
    doc.root.children = [{ kind: 'predicate', field: 'trackCount', operator: 'isMissing', value: 0 }];
    expect(codes(doc)).toContain('unsupported_operator'); // trackCount cannot be missing
    doc.root.children = [{ kind: 'predicate', field: 'albumYear', operator: 'isMissing', value: 0 }];
    expect(codes(doc)).toContain('unexpected_value');
    doc.root.children = [{ kind: 'predicate', field: 'genreStatus', operator: 'is', value: 'unknown' }];
    expect(codes(doc)).toContain('invalid_value');
    doc.root.children = [{ kind: 'predicate', field: 'albumName', operator: 'contains', value: ' ' }];
    expect(codes(doc)).toContain('invalid_value');
    doc.root.children = [{ kind: 'predicate', field: 'trackCount', operator: 'is', value: Infinity }];
    expect(codes(doc)).toContain('invalid_value');
  });

  it('rejects malformed, empty, unknown-version, and extra-key documents', () => {
    expect(codes(null)).toContain('invalid_document');
    expect(codes({ version: 1, entity: 'album', root: null })).toContain('invalid_root');
    expect(codes({ version: 2, entity: 'artist', root: { kind: 'group', combinator: 'all', children: [] } }))
      .toEqual(expect.arrayContaining(['unsupported_version', 'invalid_entity', 'empty_group']));
    const doc = album();
    doc.root.children = [];
    expect(codes(doc)).toContain('empty_group');
    expect(codes({ ...album(), rawSql: 'DROP TABLE track' })).toContain('unexpected_property');
    expect(codes({ ...album(), root: { kind: 'group', combinator: 'bogus', children: album().root.children } }))
      .toContain('invalid_combinator');
  });

  it('rejects oversized and over-nested expressions before evaluation', () => {
    const doc = album();
    doc.root.children = Array.from({ length: MAX_LIBRARY_RULE_NODES }, () => ({
      kind: 'predicate' as const, field: 'albumName', operator: 'isPresent' as const,
    }));
    expect(codes(doc)).toContain('too_many_nodes'); // root is also one node

    let nested: LibraryRuleGroup = {
      kind: 'group', combinator: 'all',
      children: [{ kind: 'predicate', field: 'albumName', operator: 'isPresent' }],
    };
    for (let i = 0; i < MAX_LIBRARY_RULE_DEPTH; i += 1) {
      nested = { kind: 'group', combinator: 'all', children: [nested] };
    }
    doc.root = nested;
    expect(codes(doc)).toContain('too_deep');
  });

  it('rejects cycles without recursive overflow', () => {
    const doc = album();
    doc.root.children.push(doc.root);
    expect(codes(doc)).toContain('circular_reference');
  });

  it('rejects additional predicate keys without mutating user input', () => {
    const doc = album();
    const suspicious = {
      kind: 'predicate', field: 'genreStatus', operator: 'is', value: 'missing',
      sql: '1=1',
    };
    doc.root.children = [suspicious as never];
    const before = JSON.stringify(doc);
    expect(codes(doc)).toContain('unexpected_property');
    expect(JSON.stringify(doc)).toBe(before);
  });
});
