import { X } from 'lucide-react';
import { useNavigate } from 'react-router';

import type { LibraryTagFilter } from '@/lib/api/library';
import { genreColor } from '@/lib/library/genreColor';
import {
  tagExplorerResultsPath,
  type TagExplorerOrigin,
} from '@/features/tagExplorer/utils/tagExplorerQuery';

interface Props {
  origin: TagExplorerOrigin;
  tags: LibraryTagFilter[];
  onRemove: (tag: LibraryTagFilter) => void;
  onClear: () => void;
  onCancel: () => void;
  selectedCountLabel: string;
  clearLabel: string;
  cancelLabel: string;
  viewResultsLabel: string;
  minimumLabel: string;
  genreLabel: string;
  moodLabel: string;
}

export default function TagExplorerSelectionBar({
  origin,
  tags,
  onRemove,
  onClear,
  onCancel,
  selectedCountLabel,
  clearLabel,
  cancelLabel,
  viewResultsLabel,
  minimumLabel,
  genreLabel,
  moodLabel,
}: Props) {
  const navigate = useNavigate();
  const ready = tags.length >= 2;

  return (
    <div className="tag-explorer-selection-bar">
      <div className="tag-explorer-selection-bar__summary">
        <strong>{selectedCountLabel}</strong>
        {!ready && (
          <span className="tag-explorer-selection-bar__hint">
            {minimumLabel}
          </span>
        )}
      </div>

      {tags.length > 0 && (
        <div className="tag-explorer-selected-tags">
          {tags.map(tag => (
            <button
              key={`${tag.kind}:${tag.value.toLocaleLowerCase()}`}
              type="button"
              className="tag-explorer-selected-tag"
              style={{
                '--genre-color': genreColor(tag.value),
              } as React.CSSProperties}
              onClick={() => onRemove(tag)}
              aria-label={`${tag.kind === 'genre' ? genreLabel : moodLabel}: ${tag.value}`}
            >
              <span className="tag-explorer-selected-tag__kind">
                {tag.kind === 'genre' ? genreLabel : moodLabel}
              </span>
              <span>{tag.value}</span>
              <X size={12} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}

      <div className="tag-explorer-selection-bar__actions">
        <button
          type="button"
          className="btn btn-ghost"
          disabled={tags.length === 0}
          onClick={onClear}
        >
          {clearLabel}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onCancel}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!ready}
          onClick={() => navigate(tagExplorerResultsPath(
            origin,
            {
              tags,
              mode: 'or',
              view: 'albums',
            },
          ))}
        >
          {viewResultsLabel}
        </button>
      </div>
    </div>
  );
}
