import { useTranslation } from 'react-i18next';
import {
  LIBRARY_RULE_FIELDS,
  libraryRuleOperatorsFor,
  validateLibraryRuleDocument,
  type LibraryRuleDocument,
  type LibraryRuleEntity,
  type LibraryRuleFieldDefinition,
  type LibraryRuleGroup,
  type LibraryRuleNode,
  type LibraryRuleOperator,
  type LibraryRulePredicate,
  type LibraryRuleValue,
} from '../utils/libraryRuleModel';
import {
  appendLibraryRuleNode,
  canAppendLibraryRuleNode,
  changeLibraryRuleEntity,
  removeLibraryRuleNode,
  replaceLibraryRuleNode,
  type LibraryRulePath,
} from '../utils/libraryRuleEditor';

interface Props {
  document: LibraryRuleDocument;
  onChange: (next: LibraryRuleDocument) => void;
  disabled?: boolean;
}

const NO_VALUE = new Set<LibraryRuleOperator>(['isPresent', 'isMissing']);

function defaultValue(field: LibraryRuleFieldDefinition): LibraryRuleValue {
  switch (field.type) {
    case 'number': return 0;
    case 'boolean': return false;
    case 'coverage': return 'missing';
    case 'text': return '';
  }
}

function PredicateEditor({
  node, path, entity, siblings, disabled, onReplace, onRemove,
}: {
  node: LibraryRulePredicate;
  path: LibraryRulePath;
  entity: LibraryRuleEntity;
  siblings: number;
  disabled: boolean;
  onReplace: (path: LibraryRulePath, node: LibraryRuleNode) => void;
  onRemove: (path: LibraryRulePath) => void;
}) {
  const { t } = useTranslation();
  const fields = LIBRARY_RULE_FIELDS[entity];
  const selected = fields.find(field => field.key === node.field) ?? fields[0];
  const operators = libraryRuleOperatorsFor(selected);
  const valueNeeded = !NO_VALUE.has(node.operator);
  const updateField = (key: string) => {
    const nextField = fields.find(field => field.key === key);
    if (!nextField) return;
    const nextOperator: LibraryRuleOperator = nextField.nullable
      ? 'isPresent'
      : nextField.type === 'text' ? 'contains' : 'is';
    onReplace(path, {
      kind: 'predicate',
      field: key,
      operator: nextOperator,
      ...(!NO_VALUE.has(nextOperator) ? { value: defaultValue(nextField) } : {}),
    });
  };
  const updateOperator = (operator: LibraryRuleOperator) => {
    if (!operators.includes(operator)) return;
    // Presence operators must OMIT the value key. An own property with
    // undefined fails the strict frontend validator before IPC.
    onReplace(path, NO_VALUE.has(operator)
      ? { kind: 'predicate', field: node.field, operator }
      : {
        kind: 'predicate', field: node.field, operator,
        value: node.value ?? defaultValue(selected),
      });
  };
  const updateValue = (value: LibraryRuleValue) => {
    onReplace(path, { ...node, value });
  };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: 8 }}>
      <select
        className="input"
        aria-label={t('settings.libraryRulesField')}
        value={node.field}
        disabled={disabled}
        onChange={event => updateField(event.target.value)}
      >
        {fields.map(field => (
          <option key={field.key} value={field.key}>
            {t('settings.libraryRulesField_' + field.key)}
          </option>
        ))}
      </select>
      <select
        className="input"
        aria-label={t('settings.libraryRulesOperator')}
        value={node.operator}
        disabled={disabled}
        onChange={event => updateOperator(event.target.value as LibraryRuleOperator)}
      >
        {operators.map(operator => (
          <option key={operator} value={operator}>
            {t('settings.libraryRulesOperator_' + operator)}
          </option>
        ))}
      </select>
      {valueNeeded && (
        selected.type === 'boolean' || selected.type === 'coverage' ? (
          <select
            className="input"
            aria-label={t('settings.libraryRulesValue')}
            value={String(node.value ?? defaultValue(selected))}
            disabled={disabled}
            onChange={event => updateValue(
              selected.type === 'boolean' ? event.target.value === 'true' : event.target.value,
            )}
          >
            {(selected.type === 'boolean'
              ? ['true', 'false']
              : ['missing', 'partial', 'complete']).map(value => (
              <option key={value} value={value}>
                {t('settings.libraryRulesValue_' + value)}
              </option>
            ))}
          </select>
        ) : (
          <input
            className="input"
            aria-label={t('settings.libraryRulesValue')}
            type={selected.type === 'number' ? 'number' : 'text'}
            step={selected.type === 'number' ? 1 : undefined}
            value={node.value === undefined ? '' : String(node.value)}
            disabled={disabled}
            onChange={event => {
              const raw = event.target.value;
              if (selected.type !== 'number' || raw.trim() === '') {
                updateValue(raw);
                return;
              }
              const number = Number(raw);
              updateValue(Number.isSafeInteger(number) ? number : raw);
            }}
          />
        )
      )}
      <button
        type="button"
        className="btn btn-ghost"
        disabled={disabled || siblings <= 1}
        aria-label={t('settings.libraryRulesRemoveCondition')}
        onClick={() => onRemove(path)}
      >
        {t('settings.libraryRulesRemove')}
      </button>
    </div>
  );
}

function GroupEditor({
  node, path, document, disabled, siblings, onReplace, onRemove, onAdd,
}: {
  node: LibraryRuleGroup;
  path: LibraryRulePath;
  document: LibraryRuleDocument;
  disabled: boolean;
  siblings: number;
  onReplace: (path: LibraryRulePath, node: LibraryRuleNode) => void;
  onRemove: (path: LibraryRulePath) => void;
  onAdd: (path: LibraryRulePath, kind: 'predicate' | 'group') => void;
}) {
  const { t } = useTranslation();
  return (
    <fieldset
      style={{
        border: '1px solid var(--border)', borderRadius: 8,
        padding: 10, minWidth: 0, margin: 0,
      }}
    >
      <legend style={{ fontSize: 12, padding: '0 4px' }}>
        {path.length === 0
          ? t('settings.libraryRulesRootGroup')
          : t('settings.libraryRulesNestedGroup')}
      </legend>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label>
          <span style={{ marginRight: 6 }}>{t('settings.libraryRulesGroupMode')}</span>
          <select
            className="input"
            value={node.combinator}
            disabled={disabled}
            onChange={event => onReplace(path, {
              ...node, combinator: event.target.value as 'all' | 'any',
            })}
          >
            <option value="all">{t('settings.libraryRulesAll')}</option>
            <option value="any">{t('settings.libraryRulesAny')}</option>
          </select>
        </label>
        {path.length > 0 && (
          <button
            type="button" className="btn btn-ghost"
            disabled={disabled || siblings <= 1}
            onClick={() => onRemove(path)}
          >
            {t('settings.libraryRulesRemoveGroup')}
          </button>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
        {node.children.map((child, index) => {
          const childPath = [...path, index];
          return child.kind === 'group'
            ? (
              <GroupEditor
                key={index}
                node={child}
                path={childPath}
                document={document}
                siblings={node.children.length}
                disabled={disabled}
                onReplace={onReplace}
                onRemove={onRemove}
                onAdd={onAdd}
              />
            ) : (
              <PredicateEditor
                key={index}
                node={child}
                path={childPath}
                entity={document.entity}
                siblings={node.children.length}
                disabled={disabled}
                onReplace={onReplace}
                onRemove={onRemove}
              />
            );
        })}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        <button
          type="button" className="btn btn-surface"
          disabled={disabled || !canAppendLibraryRuleNode(document, path, 'predicate')}
          onClick={() => onAdd(path, 'predicate')}
        >
          {t('settings.libraryRulesAddCondition')}
        </button>
        <button
          type="button" className="btn btn-surface"
          disabled={disabled || !canAppendLibraryRuleNode(document, path, 'group')}
          onClick={() => onAdd(path, 'group')}
        >
          {t('settings.libraryRulesAddGroup')}
        </button>
      </div>
    </fieldset>
  );
}

/**
 * Stage 1C1 editor only: no Tauri invocation, persistence, scanning, or
 * automatic evaluation. The parent will provide an explicit Run action later.
 */
export default function LibraryRuleBuilder({ document, onChange, disabled = false }: Props) {
  const { t } = useTranslation();
  const issues = validateLibraryRuleDocument(document);
  const replace = (path: LibraryRulePath, next: LibraryRuleNode) =>
    onChange(replaceLibraryRuleNode(document, path, next));
  const remove = (path: LibraryRulePath) =>
    onChange(removeLibraryRuleNode(document, path));
  const add = (path: LibraryRulePath, kind: 'predicate' | 'group') =>
    onChange(appendLibraryRuleNode(document, path, kind));

  return (
    <section aria-label={t('settings.libraryRulesBuilderTitle')}>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
        {t('settings.libraryRulesBuilderDescription')}
      </p>
      <label>
        <span style={{ marginRight: 8 }}>{t('settings.libraryRulesEntity')}</span>
        <select
          className="input"
          value={document.entity}
          disabled={disabled}
          onChange={event => onChange(changeLibraryRuleEntity(
            document, event.target.value as LibraryRuleEntity,
          ))}
        >
          <option value="album">{t('settings.libraryRulesAlbum')}</option>
          <option value="track">{t('settings.libraryRulesTrack')}</option>
        </select>
      </label>
      <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        {t('settings.libraryRulesEntityResetHint')}
      </p>
      <GroupEditor
        node={document.root}
        path={[]}
        document={document}
        disabled={disabled}
        siblings={1}
        onReplace={replace}
        onRemove={remove}
        onAdd={add}
      />
      {issues.length > 0 && (
        <p role="alert" style={{ color: 'var(--danger, var(--text-primary))' }}>
          {t('settings.libraryRulesInvalid', { count: issues.length })}
        </p>
      )}
    </section>
  );
}
