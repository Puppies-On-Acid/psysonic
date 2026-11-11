import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { resetAllStores } from '@/test/helpers/storeReset';
import { useAuthStore } from '@/store/authStore';
import { libraryRulesEvaluate, type RuleMatch, type RulePage } from '@/lib/api/library';
import { navigateToAlbumDetail } from '@/lib/navigation/albumDetailNavigation';
import { showToast } from '@/lib/dom/toast';
import { saveLibraryRulesCsv } from './libraryRulesCsvSave';
import LibraryRules from './LibraryRules';
import { clearLibraryRulesSession } from '../utils/libraryRulesSession';

vi.mock('@/lib/api/library/libraryRules', () => ({
  libraryRulesEvaluate: vi.fn(),
}));
vi.mock('@/lib/navigation/albumDetailNavigation', () => ({
  navigateToAlbumDetail: vi.fn(),
}));
vi.mock('./libraryRulesCsvSave', () => ({
  saveLibraryRulesCsv: vi.fn(),
}));
vi.mock('@/lib/dom/toast', () => ({
  showToast: vi.fn(),
}));

function match(name: string, itemId: string, albumId: string | null = itemId): RuleMatch {
  return {
    serverId: 's1', libraryId: null, itemId, albumId, name, artist: 'Test Artist',
  };
}

describe('Settings Library Rules manual evaluation', () => {
  beforeEach(() => {
    clearLibraryRulesSession();
    resetAllStores();
    vi.mocked(libraryRulesEvaluate).mockReset();
    vi.mocked(navigateToAlbumDetail).mockReset();
    vi.mocked(saveLibraryRulesCsv).mockReset().mockResolvedValue('saved');
    vi.mocked(showToast).mockReset();
    useAuthStore.setState({
      servers: [{
        id: 's1', name: 'Test Server', url: 'https://example.invalid',
        username: 'test', password: 'test',
      }],
      activeServerId: 's1',
      libraryBrowseServerIds: ['s1'],
      libraryBrowseSelectionByServer: {},
    });
  });

  it('never evaluates on render, editor interaction or View Results', async () => {
    vi.mocked(libraryRulesEvaluate).mockResolvedValue({
      items: [match('Missing metadata', 'album-1')], hasMore: false,
    });
    const user = userEvent.setup();
    renderWithProviders(<LibraryRules />);
    expect(libraryRulesEvaluate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'View Results' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Restore missing genre/mood preset' }));
    expect(libraryRulesEvaluate).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Run Rules' }));
    await waitFor(() => expect(libraryRulesEvaluate).toHaveBeenCalledTimes(1));
    expect(libraryRulesEvaluate).toHaveBeenCalledWith(
      expect.stringContaining('"entity":"album"'),
      [{ serverId: 's1', libraryId: null }],
      50, 0,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'View Results' })).toBeEnabled());
    expect(screen.queryByText('Missing metadata')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'View Results' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'View Results' }));
    expect(await screen.findByText('Missing metadata')).toBeInTheDocument();
    expect(libraryRulesEvaluate).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Missing metadata' }));
    expect(navigateToAlbumDetail).toHaveBeenCalledWith(
      expect.any(Function), expect.any(Object), 'album-1', { serverId: 's1' },
    );
    expect(libraryRulesEvaluate).toHaveBeenCalledTimes(1);
  });

  it('fetches bounded next and previous pages only after explicit clicks', async () => {
    vi.mocked(libraryRulesEvaluate)
      .mockResolvedValueOnce({ items: [match('First album', 'a1')], hasMore: true })
      .mockResolvedValueOnce({ items: [match('Second album', 'a2')], hasMore: false })
      .mockResolvedValueOnce({ items: [match('First album', 'a1')], hasMore: true })
      .mockResolvedValueOnce({ items: [match('Updated album', 'a3')], hasMore: false });
    const user = userEvent.setup();
    renderWithProviders(<LibraryRules />);
    await user.click(screen.getByRole('button', { name: 'Run Rules' }));
    await waitFor(() => expect(libraryRulesEvaluate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'View Results' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'View Results' }));
    expect(screen.getByText('First album')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(libraryRulesEvaluate).toHaveBeenCalledTimes(2));
    expect(libraryRulesEvaluate).toHaveBeenLastCalledWith(
      expect.any(String), [{ serverId: 's1', libraryId: null }], 50, 50,
    );
    expect(await screen.findByText('Second album')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByText('Page 2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Previous' }));
    await waitFor(() => expect(libraryRulesEvaluate).toHaveBeenCalledTimes(3));
    expect(libraryRulesEvaluate).toHaveBeenLastCalledWith(
      expect.any(String), [{ serverId: 's1', libraryId: null }], 50, 0,
    );
    expect(await screen.findByText('First album')).toBeInTheDocument();
    expect(screen.getByText('Page 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

    // A fresh Run resets the explicit View Results step even after navigating.
    await user.click(screen.getByRole('button', { name: 'Run Rules' }));
    await waitFor(() => expect(libraryRulesEvaluate).toHaveBeenCalledTimes(4));
    expect(libraryRulesEvaluate).toHaveBeenLastCalledWith(
      expect.any(String), [{ serverId: 's1', libraryId: null }], 50, 0,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'View Results' })).toBeEnabled());
    await waitFor(() => expect(screen.queryByText('First album')).not.toBeInTheDocument());
    expect(screen.queryByText('Updated album')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'View Results' }));
    expect(await screen.findByText('Updated album')).toBeInTheDocument();
  });

  it('disables Run for invalid typed conditions, then accepts a corrected value', async () => {
    vi.mocked(libraryRulesEvaluate).mockResolvedValue({
      items: [], hasMore: false,
    });
    const user = userEvent.setup();
    renderWithProviders(<LibraryRules />);
    await user.selectOptions(screen.getAllByRole('combobox', { name: 'Field' })[0], 'albumName');
    await user.selectOptions(screen.getAllByRole('combobox', { name: 'Operator' })[0], 'contains');
    expect(screen.getByRole('button', { name: 'Run Rules' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('condition errors');
    expect(libraryRulesEvaluate).not.toHaveBeenCalled();
    await user.type(screen.getByRole('textbox', { name: 'Value' }), 'Rock');
    expect(screen.getByRole('button', { name: 'Run Rules' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Run Rules' }));
    await waitFor(() => expect(libraryRulesEvaluate).toHaveBeenCalledTimes(1));
  });

  it('marks edited rules stale without automatic evaluation or stale paging', async () => {
    vi.mocked(libraryRulesEvaluate).mockResolvedValue({
      items: [match('Album', 'a1')], hasMore: true,
    });
    const user = userEvent.setup();
    renderWithProviders(<LibraryRules />);
    await user.click(screen.getByRole('button', { name: 'Run Rules' }));
    await waitFor(() => expect(libraryRulesEvaluate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'View Results' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'View Results' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Group combination' }), 'all');
    expect(await screen.findByText(/Rules or library selection changed/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(libraryRulesEvaluate).toHaveBeenCalledTimes(1);
  });

  it('marks a scope change stale without evaluating and requires an explicit rerun', async () => {
    vi.mocked(libraryRulesEvaluate).mockResolvedValue({
      items: [match('Album', 'a1')], hasMore: true,
    });
    const user = userEvent.setup();
    renderWithProviders(<LibraryRules />);
    await user.click(screen.getByRole('button', { name: 'Run Rules' }));
    await waitFor(() => expect(libraryRulesEvaluate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'View Results' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'View Results' }));

    useAuthStore.setState({ libraryBrowseSelectionByServer: { s1: ['folder-2'] } });
    expect(await screen.findByText(/Rules or library selection changed/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(libraryRulesEvaluate).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Run Rules' }));
    await waitFor(() => expect(libraryRulesEvaluate).toHaveBeenCalledTimes(2));
    expect(libraryRulesEvaluate).toHaveBeenLastCalledWith(
      expect.any(String), [{ serverId: 's1', libraryId: 'folder-2' }], 50, 0,
    );
  });

  it('shows backend errors and permits an explicit retry', async () => {
    vi.mocked(libraryRulesEvaluate)
      .mockRejectedValueOnce(new Error('Genre/mood projection backfill is incomplete'))
      .mockResolvedValueOnce({ items: [], hasMore: false });
    const user = userEvent.setup();
    renderWithProviders(<LibraryRules />);
    await user.click(screen.getByRole('button', { name: 'Run Rules' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('backfill is incomplete');
    expect(screen.getByRole('button', { name: 'View Results' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Run Rules' }));
    await waitFor(() => expect(libraryRulesEvaluate).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: 'View Results' })).toBeEnabled());
    await waitFor(() => expect(screen.getByRole('button', { name: 'View Results' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'View Results' }));
    expect(screen.getByText('No items match these rules.')).toBeInTheDocument();
  });

  it('handles track matches, including orphan tracks without a linked album', async () => {
    vi.mocked(libraryRulesEvaluate).mockResolvedValueOnce({
      items: [
        match('Track with album', 'track-1', 'album-1'),
        match('Orphan track', 'track-2', null),
      ],
      hasMore: false,
    });
    const user = userEvent.setup();
    renderWithProviders(<LibraryRules />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Apply rules to' }), 'track');
    expect(libraryRulesEvaluate).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Run Rules' }));
    await waitFor(() => expect(libraryRulesEvaluate).toHaveBeenCalledTimes(1));
    const requestJson = vi.mocked(libraryRulesEvaluate).mock.calls[0][0];
    expect(JSON.parse(requestJson).entity).toBe('track');
    await waitFor(() => expect(screen.getByRole('button', { name: 'View Results' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'View Results' }));
    expect(screen.getByText('Orphan track')).toBeInTheDocument();
    expect(screen.getByText('No linked album')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open album' }));
    expect(navigateToAlbumDetail).toHaveBeenCalledWith(
      expect.any(Function), expect.any(Object), 'album-1', { serverId: 's1' },
    );
  });

  it('restores edited rules and the last visible page after navigation without re-running', async () => {
    vi.mocked(libraryRulesEvaluate)
      .mockResolvedValueOnce({ items: [match('First album', 'a1')], hasMore: true })
      .mockResolvedValueOnce({ items: [match('Second album', 'a2')], hasMore: false });
    const user = userEvent.setup();
    const screenA = renderWithProviders(<LibraryRules />);

    await user.click(screen.getByRole('button', { name: 'Run Rules' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'View Results' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'View Results' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Second album')).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Group combination' }), 'all');
    expect(await screen.findByText(/Rules or library selection changed/)).toBeInTheDocument();
    expect(libraryRulesEvaluate).toHaveBeenCalledTimes(2);

    screenA.unmount();
    renderWithProviders(<LibraryRules />);
    expect(screen.getByRole('combobox', { name: 'Group combination' })).toHaveValue('all');
    expect(screen.getByText('Second album')).toBeInTheDocument();
    expect(screen.getByText('Page 2')).toBeInTheDocument();
    expect(screen.getByText(/Rules or library selection changed/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(libraryRulesEvaluate).toHaveBeenCalledTimes(2);
  });

  it('shows restored results as stale if the selected library changed while away', async () => {
    vi.mocked(libraryRulesEvaluate).mockResolvedValue({
      items: [match('Selected album', 'a1')], hasMore: true,
    });
    const user = userEvent.setup();
    const screenA = renderWithProviders(<LibraryRules />);
    await user.click(screen.getByRole('button', { name: 'Run Rules' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'View Results' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'View Results' }));
    expect(screen.getByText('Selected album')).toBeInTheDocument();
    screenA.unmount();

    useAuthStore.setState({ libraryBrowseSelectionByServer: { s1: ['other-folder'] } });
    renderWithProviders(<LibraryRules />);
    expect(screen.getByText('Selected album')).toBeInTheDocument();
    expect(screen.getByText(/Rules or library selection changed/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(libraryRulesEvaluate).toHaveBeenCalledTimes(1);
  });

  it('only exports after an explicit click, and includes every matched page', async () => {
    const data = Array.from({ length: 200 }, (_, i) => match('Match ' + i, 'a' + i));
    vi.mocked(libraryRulesEvaluate)
      .mockResolvedValueOnce({ items: [match('Preview only', 'preview')], hasMore: true })
      .mockResolvedValueOnce({ items: data, hasMore: true })
      .mockResolvedValueOnce({ items: [match('Last match', 'end')], hasMore: false });
    const user = userEvent.setup();
    renderWithProviders(<LibraryRules />);
    expect(saveLibraryRulesCsv).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Run Rules' }));
    await waitFor(() => expect(libraryRulesEvaluate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export All Matches' })).toBeEnabled());
    expect(saveLibraryRulesCsv).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Export All Matches' }));
    await waitFor(() => expect(saveLibraryRulesCsv).toHaveBeenCalledTimes(1));
    expect(libraryRulesEvaluate).toHaveBeenCalledTimes(3);
    expect(libraryRulesEvaluate).toHaveBeenNthCalledWith(
      2, expect.any(String), [{ serverId: 's1', libraryId: null }], 200, 0,
    );
    expect(libraryRulesEvaluate).toHaveBeenNthCalledWith(
      3, expect.any(String), [{ serverId: 's1', libraryId: null }], 200, 200,
    );
    const [bytes, entity, dialog] = vi.mocked(saveLibraryRulesCsv).mock.calls[0];
    expect(entity).toBe('album');
    expect(dialog).toBe('Save all matching library rules as CSV');
    const csv = new TextDecoder().decode(bytes);
    expect(csv).toContain('"Last match"');
    expect(csv).toContain('"Match 0"');
    expect(csv).not.toContain('Preview only');
    expect(showToast).toHaveBeenCalledWith('CSV saved with 201 matching rows.', 2800, 'success');
  });

  it('shows batch progress, allows cancellation and never saves partial output', async () => {
    let finish!: (page: RulePage) => void;
    const firstPage = Array.from({ length: 200 }, (_, i) => match('Row ' + i, 'a' + i));
    vi.mocked(libraryRulesEvaluate)
      .mockResolvedValueOnce({ items: [match('Preview', 'preview')], hasMore: true })
      .mockResolvedValueOnce({ items: firstPage, hasMore: true })
      .mockImplementationOnce(() => new Promise<RulePage>(resolve => { finish = resolve; }));
    const user = userEvent.setup();
    renderWithProviders(<LibraryRules />);
    await user.click(screen.getByRole('button', { name: 'Run Rules' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export All Matches' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Export All Matches' }));
    expect(await screen.findByText(/Collecting matches: 200 rows/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run Rules' })).toBeDisabled();
    await waitFor(() => expect(libraryRulesEvaluate).toHaveBeenCalledTimes(3));
    await user.click(screen.getByRole('button', { name: 'Cancel export' }));
    finish({ items: [match('Last match', 'end')], hasMore: false });
    expect(await screen.findByText('CSV export cancelled. No file was saved.')).toBeInTheDocument();
    expect(saveLibraryRulesCsv).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
    expect(libraryRulesEvaluate).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('button', { name: 'Export All Matches' })).toBeEnabled();
  });

  it('rejects later page errors without opening the Save dialog', async () => {
    vi.mocked(libraryRulesEvaluate)
      .mockResolvedValueOnce({ items: [match('Preview', 'preview')], hasMore: true })
      .mockResolvedValueOnce({
        items: Array.from({ length: 200 }, (_, i) => match('Match ' + i, 'a' + i)),
        hasMore: true,
      })
      .mockRejectedValueOnce(new Error('SQLite busy'));
    const user = userEvent.setup();
    renderWithProviders(<LibraryRules />);
    await user.click(screen.getByRole('button', { name: 'Run Rules' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export All Matches' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Export All Matches' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('SQLite busy');
    expect(saveLibraryRulesCsv).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      'Could not complete the Library Rules CSV export.', 4000, 'error',
    );
    expect(screen.getByRole('button', { name: 'Export All Matches' })).toBeEnabled();
  });

  it('blocks export if the rule was changed after the last successful run', async () => {
    vi.mocked(libraryRulesEvaluate).mockResolvedValue({
      items: [match('Preview', 'preview')], hasMore: false,
    });
    const user = userEvent.setup();
    renderWithProviders(<LibraryRules />);
    await user.click(screen.getByRole('button', { name: 'Run Rules' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export All Matches' })).toBeEnabled());
    await user.selectOptions(screen.getByRole('combobox', { name: 'Group combination' }), 'all');
    expect(screen.getByRole('button', { name: 'Export All Matches' })).toBeDisabled();
    expect(libraryRulesEvaluate).toHaveBeenCalledTimes(1);
    expect(saveLibraryRulesCsv).not.toHaveBeenCalled();
  });

  it('rejects export when the selected library changes while a batch is running', async () => {
    let finish!: (page: RulePage) => void;
    vi.mocked(libraryRulesEvaluate)
      .mockResolvedValueOnce({ items: [match('Preview', 'preview')], hasMore: false })
      .mockImplementationOnce(() => new Promise<RulePage>(resolve => { finish = resolve; }));
    const user = userEvent.setup();
    renderWithProviders(<LibraryRules />);
    await user.click(screen.getByRole('button', { name: 'Run Rules' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export All Matches' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Export All Matches' }));
    await waitFor(() => expect(libraryRulesEvaluate).toHaveBeenCalledTimes(2));
    useAuthStore.setState({ libraryBrowseSelectionByServer: { s1: ['another-folder'] } });
    finish({ items: [match('Result', 'result')], hasMore: false });
    expect(await screen.findByRole('alert')).toHaveTextContent('Library selection changed during export');
    expect(saveLibraryRulesCsv).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      'Could not complete the Library Rules CSV export.', 4000, 'error',
    );
  });

  it('handles native Save cancellation without claiming the CSV was saved', async () => {
    vi.mocked(libraryRulesEvaluate).mockResolvedValue({
      items: [match('Result', 'result')], hasMore: false,
    });
    vi.mocked(saveLibraryRulesCsv).mockResolvedValueOnce('cancelled');
    const user = userEvent.setup();
    renderWithProviders(<LibraryRules />);
    await user.click(screen.getByRole('button', { name: 'Run Rules' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export All Matches' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Export All Matches' }));
    expect(await screen.findByText('CSV export cancelled. No file was saved.')).toBeInTheDocument();
    expect(saveLibraryRulesCsv).toHaveBeenCalledTimes(1);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('reports native save failures without a false success message', async () => {
    vi.mocked(libraryRulesEvaluate).mockResolvedValue({
      items: [match('Result', 'result')], hasMore: false,
    });
    vi.mocked(saveLibraryRulesCsv).mockRejectedValueOnce(new Error('disk full'));
    const user = userEvent.setup();
    renderWithProviders(<LibraryRules />);
    await user.click(screen.getByRole('button', { name: 'Run Rules' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export All Matches' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Export All Matches' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('disk full');
    expect(saveLibraryRulesCsv).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith(
      'Could not complete the Library Rules CSV export.', 4000, 'error',
    );
    expect(screen.queryByText(/CSV saved with/)).not.toBeInTheDocument();
  });

  it('does not open a delayed Save picker after leaving Settings during an export', async () => {
    let finish!: (page: RulePage) => void;
    vi.mocked(libraryRulesEvaluate)
      .mockResolvedValueOnce({ items: [match('Preview', 'preview')], hasMore: false })
      .mockImplementationOnce(() => new Promise<RulePage>(resolve => { finish = resolve; }));
    const user = userEvent.setup();
    const mounted = renderWithProviders(<LibraryRules />);
    await user.click(screen.getByRole('button', { name: 'Run Rules' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export All Matches' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Export All Matches' }));
    await waitFor(() => expect(libraryRulesEvaluate).toHaveBeenCalledTimes(2));
    await act(async () => {
      mounted.unmount();
      finish({ items: [match('Later result', 'later')], hasMore: false });
    });
    expect(saveLibraryRulesCsv).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('never starts a rule scan when no library is selected', () => {
    useAuthStore.setState({
      servers: [],
      activeServerId: null,
      libraryBrowseServerIds: [],
      libraryBrowseSelectionByServer: {},
    });
    renderWithProviders(<LibraryRules />);
    expect(screen.getByRole('status')).toHaveTextContent('Select a library');
    expect(screen.getByRole('button', { name: 'Run Rules' })).toBeDisabled();
    expect(libraryRulesEvaluate).not.toHaveBeenCalled();
  });
});
