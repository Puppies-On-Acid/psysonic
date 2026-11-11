/**
 * Stage 1A: local Library Rules document contract.
 *
 * Rules describe a read-only query, not user-supplied SQL. The Rust evaluator
 * must independently validate every field, operator, value and depth; this
 * frontend validator is for editing and early feedback, not a security boundary.
 *
 * Scope is supplied by the current library selection when a rule is executed.
 * Persisting named templates and deciding fixed-vs-current scope are Stage 2.
 */

export const LIBRARY_RULE_VERSION = 1 as const;
export const MAX_LIBRARY_RULE_NODES = 64;
export const MAX_LIBRARY_RULE_DEPTH = 5;

export type LibraryRuleEntity = 'album' | 'track';
export type LibraryRuleFieldType = 'text' | 'number' | 'boolean' | 'coverage';
export type LibraryRuleCoverage = 'complete' | 'partial' | 'missing';
export type LibraryRuleOperator =
  | 'is'
  | 'isNot'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'greaterThan'
  | 'atLeast'
  | 'lessThan'
  | 'atMost'
  | 'isPresent'
  | 'isMissing';
export type LibraryRuleValue = string | number | boolean;

export interface LibraryRulePredicate {
  kind: 'predicate';
  field: string;
  operator: LibraryRuleOperator;
  /** Absent for isPresent/isMissing; never interpreted as raw SQL. */
  value?: LibraryRuleValue;
}

export interface LibraryRuleGroup {
  kind: 'group';
  combinator: 'all' | 'any';
  children: LibraryRuleNode[];
}

export type LibraryRuleNode = LibraryRuleGroup | LibraryRulePredicate;

export interface LibraryRuleDocument {
  version: typeof LIBRARY_RULE_VERSION;
  entity: LibraryRuleEntity;
  root: LibraryRuleGroup;
}

export interface LibraryRuleFieldDefinition {
  key: string;
  type: LibraryRuleFieldType;
  /** The field is defined by the actual local SQLite schema/projections. */
  indexedFrom: 'album' | 'track' | 'aggregate' | 'tag-projection';
  nullable: boolean;
}

/**
 * Conservative initial registry; additional fields require confirmed local
 * storage semantics and a matching Rust evaluator mapping. Smart Playlist
 * server fields are NOT implicitly available in this local rule engine.
 */
export const LIBRARY_RULE_FIELDS: Readonly<Record<LibraryRuleEntity, readonly LibraryRuleFieldDefinition[]>> = {
  album: [
    { key: 'albumName', type: 'text', indexedFrom: 'album', nullable: true },
    { key: 'albumArtist', type: 'text', indexedFrom: 'album', nullable: true },
    { key: 'albumYear', type: 'number', indexedFrom: 'album', nullable: true },
    { key: 'trackCount', type: 'number', indexedFrom: 'aggregate', nullable: false },
    { key: 'genreStatus', type: 'coverage', indexedFrom: 'aggregate', nullable: false },
    { key: 'moodStatus', type: 'coverage', indexedFrom: 'aggregate', nullable: false },
    { key: 'genreMissingTracks', type: 'number', indexedFrom: 'aggregate', nullable: false },
    { key: 'moodMissingTracks', type: 'number', indexedFrom: 'aggregate', nullable: false },
    { key: 'albumGenrePresent', type: 'boolean', indexedFrom: 'album', nullable: false },
  ],
  track: [
    { key: 'trackTitle', type: 'text', indexedFrom: 'track', nullable: false },
    { key: 'trackArtist', type: 'text', indexedFrom: 'track', nullable: true },
    { key: 'albumName', type: 'text', indexedFrom: 'track', nullable: true },
    { key: 'trackYear', type: 'number', indexedFrom: 'track', nullable: true },
    { key: 'durationSeconds', type: 'number', indexedFrom: 'track', nullable: false },
    { key: 'bitRate', type: 'number', indexedFrom: 'track', nullable: true },
    { key: 'playCount', type: 'number', indexedFrom: 'track', nullable: true },
    { key: 'genrePresent', type: 'boolean', indexedFrom: 'tag-projection', nullable: false },
    { key: 'moodPresent', type: 'boolean', indexedFrom: 'tag-projection', nullable: false },
  ],
};

const OPERATORS: Readonly<Record<LibraryRuleFieldType, readonly LibraryRuleOperator[]>> = {
  text: ['is', 'isNot', 'contains', 'notContains', 'startsWith', 'endsWith', 'isPresent', 'isMissing'],
  number: ['is', 'isNot', 'greaterThan', 'atLeast', 'lessThan', 'atMost', 'isPresent', 'isMissing'],
  boolean: ['is', 'isNot'],
  coverage: ['is', 'isNot'],
};

export function libraryRuleFieldsFor(entity: LibraryRuleEntity): readonly LibraryRuleFieldDefinition[] {
  return LIBRARY_RULE_FIELDS[entity];
}

export function libraryRuleOperatorsFor(field: LibraryRuleFieldDefinition): readonly LibraryRuleOperator[] {
  return OPERATORS[field.type].filter(operator =>
    field.nullable || (operator !== 'isPresent' && operator !== 'isMissing'));
}

export type LibraryRuleValidationCode =
  | 'invalid_document'
  | 'unsupported_version'
  | 'invalid_entity'
  | 'invalid_root'
  | 'invalid_node'
  | 'invalid_combinator'
  | 'empty_group'
  | 'unknown_field'
  | 'unsupported_operator'
  | 'missing_value'
  | 'unexpected_value'
  | 'invalid_value'
  | 'unexpected_property'
  | 'too_many_nodes'
  | 'too_deep'
  | 'circular_reference';

export interface LibraryRuleValidationIssue {
  code: LibraryRuleValidationCode;
  /** JSON-pointer-like location; future UI can focus the affected row. */
  path: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

const NO_VALUE_OPERATORS = new Set<LibraryRuleOperator>(['isPresent', 'isMissing']);

function isTypedValue(value: unknown, type: LibraryRuleFieldType): boolean {
  switch (type) {
    case 'text':
      return typeof value === 'string' && value.trim().length > 0 && value.length <= 4096;
    case 'number':
      return typeof value === 'number' && Number.isSafeInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'coverage':
      return value === 'complete' || value === 'partial' || value === 'missing';
  }
}

function extraneousKey(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return Object.keys(value).some(key => !keys.includes(key));
}

/**
 * Validate untrusted JSON without normalizing or dropping unknown conditions.
 * A document with any issues must never be sent to the evaluator.
 */
export function validateLibraryRuleDocument(input: unknown): LibraryRuleValidationIssue[] {
  const issues: LibraryRuleValidationIssue[] = [];
  const fail = (path: string, code: LibraryRuleValidationCode) => issues.push({ path, code });
  const doc = record(input);
  if (!doc) return [{ path: '/', code: 'invalid_document' }];

  if (doc.version !== LIBRARY_RULE_VERSION) fail('/version', 'unsupported_version');
  const entity = doc.entity;
  if (entity !== 'album' && entity !== 'track') fail('/entity', 'invalid_entity');
  if (extraneousKey(doc, ['version', 'entity', 'root'])) fail('/', 'unexpected_property');

  const root = record(doc.root);
  if (!root || root.kind !== 'group') {
    fail('/root', 'invalid_root');
    return issues;
  }

  const fields = entity === 'album' || entity === 'track' ? LIBRARY_RULE_FIELDS[entity] : [];
  const seen = new WeakSet<object>();
  let visited = 0;
  let limitReached = false;
  const walk = (node: unknown, path: string, depth: number) => {
    if (limitReached) return;
    visited += 1;
    if (visited > MAX_LIBRARY_RULE_NODES) {
      fail(path, 'too_many_nodes');
      limitReached = true;
      return;
    }
    if (depth > MAX_LIBRARY_RULE_DEPTH) {
      fail(path, 'too_deep');
      return;
    }
    const value = record(node);
    if (!value) {
      fail(path, 'invalid_node');
      return;
    }
    if (seen.has(value)) {
      fail(path, 'circular_reference');
      return;
    }
    seen.add(value);

    if (value.kind === 'group') {
      if (extraneousKey(value, ['kind', 'combinator', 'children'])) {
        fail(path, 'unexpected_property');
      }
      if (value.combinator !== 'all' && value.combinator !== 'any') {
        fail(path + '/combinator', 'invalid_combinator');
      }
      if (!Array.isArray(value.children) || value.children.length === 0) {
        fail(path + '/children', 'empty_group');
        return;
      }
      for (let i = 0; i < value.children.length && !limitReached; i += 1) {
        walk(value.children[i], path + '/children/' + i, depth + 1);
      }
      return;
    }
    if (value.kind !== 'predicate') {
      fail(path, 'invalid_node');
      return;
    }
    if (extraneousKey(value, ['kind', 'field', 'operator', 'value'])) {
      fail(path, 'unexpected_property');
    }
    const field = fields.find(candidate => candidate.key === value.field);
    if (!field) {
      fail(path + '/field', 'unknown_field');
      return;
    }
    const operator = value.operator;
    if (typeof operator !== 'string' ||
        !libraryRuleOperatorsFor(field).some(allowed => allowed === operator)) {
      fail(path + '/operator', 'unsupported_operator');
      return;
    }
    if (NO_VALUE_OPERATORS.has(operator as LibraryRuleOperator)) {
      if (Object.prototype.hasOwnProperty.call(value, 'value')) {
        fail(path + '/value', 'unexpected_value');
      }
    } else if (!Object.prototype.hasOwnProperty.call(value, 'value')) {
      fail(path + '/value', 'missing_value');
    } else if (!isTypedValue(value.value, field.type)) {
      fail(path + '/value', 'invalid_value');
    }
  };

  walk(root, '/root', 1);
  return issues;
}

/**
 * Compatibility preset: reproduces the existing audit's "genre OR mood
 * incomplete" album selection. Full/partial/missing classifications stay
 * defined by the existing Rust audit oracle, including album-level genre.
 */
export function builtInMissingMetadataRule(entity: LibraryRuleEntity): LibraryRuleDocument {
  if (entity === 'album') {
    return {
      version: LIBRARY_RULE_VERSION,
      entity,
      root: {
        kind: 'group',
        combinator: 'any',
        children: [
          { kind: 'predicate', field: 'genreStatus', operator: 'isNot', value: 'complete' },
          { kind: 'predicate', field: 'moodStatus', operator: 'isNot', value: 'complete' },
        ],
      },
    };
  }
  return {
    version: LIBRARY_RULE_VERSION,
    entity,
    root: {
      kind: 'group',
      combinator: 'any',
      children: [
        { kind: 'predicate', field: 'genrePresent', operator: 'is', value: false },
        { kind: 'predicate', field: 'moodPresent', operator: 'is', value: false },
      ],
    },
  };
}
