import { Search, X } from 'lucide-react';

import type { TagCatalogSort } from '@/lib/library/tagCatalogDiscovery';
import SortDropdown from '@/ui/SortDropdown';

interface Props {
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  clearSearchLabel: string;
  sort: TagCatalogSort;
  onSortChange: (value: TagCatalogSort) => void;
  popularityLabel: string;
  alphabeticalLabel: string;
  sortTooltip: string;
}

export default function TagCatalogDiscoveryToolbar({
  search,
  onSearchChange,
  searchPlaceholder,
  clearSearchLabel,
  sort,
  onSortChange,
  popularityLabel,
  alphabeticalLabel,
  sortTooltip,
}: Props) {
  return (
    <div
      className="album-track-toolbar"
      style={{
        padding: '0 0 1rem',
      }}
    >
      <div
        className="album-track-toolbar-filter"
        style={{
          maxWidth: 420,
        }}
      >
        <Search
          size={16}
          style={{
            position: 'absolute',
            left: 10,
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--text-muted)',
            pointerEvents: 'none',
          }}
        />
        <input
          className="input-search"
          style={{
            width: '100%',
            paddingRight: search ? 28 : undefined,
          }}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          value={search}
          onChange={event => onSearchChange(event.target.value)}
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            aria-label={clearSearchLabel}
            data-tooltip={clearSearchLabel}
            style={{
              position: 'absolute',
              right: 6,
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              padding: 2,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X size={14} />
          </button>
        )}
      </div>

      <div className="album-track-toolbar-actions">
        <SortDropdown
          value={sort}
          options={[
            { value: 'popularity', label: popularityLabel },
            { value: 'alphabetical', label: alphabeticalLabel },
          ]}
          onChange={onSortChange}
          tooltip={sortTooltip}
          ariaLabel={sortTooltip}
          align="right"
        />
      </div>
    </div>
  );
}
