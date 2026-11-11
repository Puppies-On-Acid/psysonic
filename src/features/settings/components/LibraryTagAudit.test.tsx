import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { resetAllStores } from '@/test/helpers/storeReset';
import { useAuthStore } from '@/store/authStore';
import { libraryTagAudit } from '@/lib/api/library';
import LibraryTagAudit from './LibraryTagAudit';

vi.mock('@/lib/api/library/tagAudit', () => ({
  libraryTagAudit: vi.fn(),
}));

const exportMocks = vi.hoisted(() => ({
  saveTagAuditCsv: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('./tagAuditCsvSave', () => ({ saveTagAuditCsv: exportMocks.saveTagAuditCsv }));
vi.mock('@/lib/dom/toast', () => ({ showToast: exportMocks.showToast }));

describe('Settings library tag audit', () => {
  beforeEach(() => {
    resetAllStores();
    vi.mocked(libraryTagAudit).mockReset();
    exportMocks.saveTagAuditCsv.mockReset().mockResolvedValue('saved');
    exportMocks.showToast.mockReset();
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
    await waitFor(() => expect(screen.getByRole('button', { name: 'View Results' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'View Results' }));
    expect(await screen.findByText('An Album')).toBeInTheDocument();
    expect(libraryTagAudit).toHaveBeenCalledTimes(1);

    // Export uses the already captured snapshot, never starts a new audit.
    await user.click(screen.getByRole('button', { name: 'Export filtered CSV' }));
    await waitFor(() => expect(exportMocks.saveTagAuditCsv).toHaveBeenCalledWith(
      [expect.objectContaining({ albumId: 'a1' })],
      'Save library tag audit CSV',
    ));
    expect(exportMocks.showToast).toHaveBeenCalledWith('CSV saved successfully.', 2800, 'success');
    expect(libraryTagAudit).toHaveBeenCalledTimes(1);

    // Cancelling the file picker should be silent and should not suggest a save.
    exportMocks.showToast.mockClear();
    exportMocks.saveTagAuditCsv.mockResolvedValueOnce('cancelled');
    await user.click(screen.getByRole('button', { name: 'Export filtered CSV' }));
    await waitFor(() => expect(exportMocks.saveTagAuditCsv).toHaveBeenCalledTimes(2));
    expect(exportMocks.showToast).not.toHaveBeenCalled();

    // Failed saves report an error and permit another attempt.
    exportMocks.saveTagAuditCsv.mockRejectedValueOnce(new Error('access denied'));
    await user.click(screen.getByRole('button', { name: 'Export filtered CSV' }));
    await waitFor(() => expect(exportMocks.showToast).toHaveBeenCalledWith(
      'Could not save CSV. Check the destination and try again.', 4000, 'error',
    ));
    expect(screen.getByRole('button', { name: 'Export filtered CSV' })).toBeEnabled();
  });
});
