import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { resetAllStores } from '@/test/helpers/storeReset';
import { useAuthStore } from '@/store/authStore';
import { libraryTagAudit } from '@/lib/api/library/tagAudit';
import LibraryTagAudit from './LibraryTagAudit';

vi.mock('@/lib/api/library/tagAudit', () => ({
  libraryTagAudit: vi.fn(),
}));

describe('Settings library tag audit', () => {
  beforeEach(() => {
    resetAllStores();
    vi.mocked(libraryTagAudit).mockReset();
    useAuthStore.setState({
      servers: [{
        id: 's1', name: 'Test Server', url: 'https://example.invalid',
        username: 'test', password: 'test',
      }],
      activeServerId: 's1',
      libraryBrowseServerIds: ['s1'],
    });
  });

  it('never audits on render or on View Results, only on Run Audit', async () => {
    vi.mocked(libraryTagAudit).mockResolvedValue({
      summary: {
        albumsChecked: 2, tracksChecked: 4, genreMissing: 1, genrePartial: 0,
        moodMissing: 1, moodPartial: 0, missingBoth: 1,
      },
      albums: [{
        serverId: 's1', libraryId: null, albumId: 'a1', name: 'An Album',
        artist: 'Test Artist', trackCount: 2, genreTaggedTracks: 0,
        moodTaggedTracks: 0, albumGenreTagged: false, genreStatus: 'missing',
        moodStatus: 'missing',
      }],
    });
    const user = userEvent.setup();
    renderWithProviders(<LibraryTagAudit />);
    expect(libraryTagAudit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'View Results' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Run Audit' }));
    expect(libraryTagAudit).toHaveBeenCalledTimes(1);
    expect(libraryTagAudit).toHaveBeenCalledWith([{ serverId: 's1', libraryId: null }]);
    await user.click(await screen.findByRole('button', { name: 'View Results' }));
    expect(await screen.findByText('An Album')).toBeInTheDocument();
    expect(libraryTagAudit).toHaveBeenCalledTimes(1);
  });
});
