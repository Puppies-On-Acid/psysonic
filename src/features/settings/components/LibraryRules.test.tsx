import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { resetAllStores } from '@/test/helpers/storeReset';
import { useAuthStore } from '@/store/authStore';
import { libraryRulesEvaluate, type RuleMatch } from '@/lib/api/library';
import { navigateToAlbumDetail } from '@/lib/navigation/albumDetailNavigation';
import LibraryRules from './LibraryRules';

vi.mock('@/lib/api/library/libraryRules', () => ({
  libraryRulesEvaluate: vi.fn(),
}));
vi.mock('@/lib/navigation/albumDetailNavigation', () => ({
  navigateToAlbumDetail: vi.fn(),
}));

function match(name: string, itemId: string, albumId: string | null = itemId): RuleMatch {
  return {
    serverId: 's1', libraryId: null, itemId, albumId, name, artist: 'Test Artist',
  };
}

describe('Settings Library Rules manual evaluation', () => {
  beforeEach(() => {
    resetAllStores();
    vi.mocked(libraryRulesEvaluate).mockReset();
    vi.mocked(navigateToAlbumDetail).mockReset();
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
      .mockResolvedValueOnce({ items: [match('First album', 'a1')], hasMore: true });
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
