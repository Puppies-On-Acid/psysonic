import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import {
  builtInMissingMetadataRule,
  validateLibraryRuleDocument,
  type LibraryRuleDocument,
} from '../utils/libraryRuleModel';
import LibraryRuleBuilder from './LibraryRuleBuilder';

function ControlledBuilder({ onChange = () => {} }: {
  onChange?: (next: LibraryRuleDocument) => void;
}) {
  const [document, setDocument] = useState(() => builtInMissingMetadataRule('album'));
  return (
    <LibraryRuleBuilder
      document={document}
      onChange={next => { setDocument(next); onChange(next); }}
    />
  );
}

describe('Library Rules condition builder', () => {
  it('never executes or mutates rules on render', () => {
    const onChange = vi.fn();
    renderWithProviders(<ControlledBuilder onChange={onChange} />);
    expect(screen.getByRole('region', { name: 'Library rules condition builder' }))
      .toBeInTheDocument();
    expect(screen.getAllByRole('combobox', { name: 'Field' })).toHaveLength(2);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('adds nested condition groups, changes their combinator and removes the group', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<ControlledBuilder onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Add group' }));
    expect(screen.getByRole('button', { name: 'Remove group' })).toBeEnabled();
    expect(screen.getAllByRole('combobox', { name: 'Field' })).toHaveLength(3);
    const groupSelectors = screen.getAllByRole('combobox', { name: /Group combination/ });
    await user.selectOptions(groupSelectors[1], 'any');
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      root: expect.objectContaining({
        children: expect.arrayContaining([expect.objectContaining({
          kind: 'group', combinator: 'any',
        })]),
      }),
    }));
    await user.click(screen.getByRole('button', { name: 'Remove group' }));
    expect(screen.getAllByRole('combobox', { name: 'Field' })).toHaveLength(2);
  });

  it('updates typed predicate values without automatically evaluating anything', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<ControlledBuilder onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Add condition' }));
    const fields = screen.getAllByRole('combobox', { name: 'Field' });
    await user.selectOptions(fields[2], 'trackCount');
    const values = screen.getAllByRole('spinbutton', { name: 'Value' });
    await user.clear(values[0]);
    await user.type(values[0], '12');
    const last = onChange.mock.lastCall?.[0] as LibraryRuleDocument;
    expect(last.root.children[2]).toEqual({
      kind: 'predicate', field: 'trackCount', operator: 'is', value: 12,
    });
    expect(validateLibraryRuleDocument(last)).toEqual([]);
  });

  it('resets cross-entity conditions safely when switching to track rules', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<ControlledBuilder onChange={onChange} />);
    await user.selectOptions(screen.getByRole('combobox', { name: /Apply rules to/ }), 'track');
    const updated = onChange.mock.lastCall?.[0] as LibraryRuleDocument;
    expect(updated.entity).toBe('track');
    expect(updated.root.children[0]).toEqual({
      kind: 'predicate', field: 'genrePresent', operator: 'is', value: false,
    });
    expect(validateLibraryRuleDocument(updated)).toEqual([]);
  });
});
