import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';

const hoisted = vi.hoisted(() => ({
  refs: vi.fn(),
  toast: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock('@/lib/api/library', () => ({
  libraryTagExplorerTrackRefs: hoisted.refs,
}));

vi.mock('@/lib/dom/toast', () => ({
  showToast: hoisted.toast,
}));

vi.mock('@/store/confirmModalStore', () => ({
  useConfirmModalStore: {
    getState: () => ({ request: hoisted.confirm }),
  },
}));

vi.mock('@/features/contextMenu/components/AddToPlaylistSubmenu', () => ({
  AddToPlaylistSubmenu: ({
    onSuccess,
  }: {
    onSuccess?: () => void;
  }) => (
    <button type="button" onClick={onSuccess}>
      Mock playlist target
    </button>
  ),
}));

import TagExplorerPlaylistAction from './TagExplorerPlaylistAction';

const scope = {
  anchorServerId: 's1',
  serverIds: ['s1'],
  pairs: [{ serverId: 's1', libraryId: null }],
  fingerprint: 'scope',
  multiServer: false,
};

const tags = [
  { kind: 'genre' as const, value: 'Rock' },
  { kind: 'mood' as const, value: 'Dreamy' },
];

describe('TagExplorerPlaylistAction', () => {
  beforeEach(() => {
    hoisted.refs.mockReset();
    hoisted.toast.mockReset();
    hoisted.confirm.mockReset();
    hoisted.confirm.mockResolvedValue(true);
  });

  it('blocks a complete selection that resolves to multiple servers', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    hoisted.refs.mockResolvedValue({
      tracks: [
        { serverId: 's1', trackId: 't1' },
        { serverId: 's2', trackId: 't2' },
      ],
      hasMore: false,
    });

    renderWithProviders(
      <TagExplorerPlaylistAction
        serverId="s1"
        browseScope={scope}
        tags={tags}
        mode="or"
        allMatching
        exclusions={new Set()}
        explicitRefs={[]}
        selectedCount={2}
        onSuccess={onSuccess}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'Add to playlist' }),
    );

    expect(hoisted.toast).toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: 'Mock playlist target' }),
    ).not.toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('clears only after the playlist submenu reports success', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();

    renderWithProviders(
      <TagExplorerPlaylistAction
        serverId="s1"
        browseScope={scope}
        tags={tags}
        mode="or"
        allMatching={false}
        exclusions={new Set()}
        explicitRefs={[{ serverId: 's1', trackId: 't1' }]}
        selectedCount={1}
        onSuccess={onSuccess}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'Add to playlist' }),
    );
    expect(onSuccess).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole('button', { name: 'Mock playlist target' }),
    );
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('asks before materializing a complete result larger than one server batch', async () => {
    const user = userEvent.setup();
    hoisted.confirm.mockResolvedValue(false);

    renderWithProviders(
      <TagExplorerPlaylistAction
        serverId="s1"
        browseScope={scope}
        tags={tags}
        mode="and"
        allMatching
        exclusions={new Set()}
        explicitRefs={[]}
        selectedCount={151}
        onSuccess={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'Add to playlist' }),
    );

    expect(hoisted.confirm).toHaveBeenCalledTimes(1);
    expect(hoisted.refs).not.toHaveBeenCalled();
  });
});
