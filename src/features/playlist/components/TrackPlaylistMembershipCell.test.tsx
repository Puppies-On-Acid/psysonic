import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { useLocation } from 'react-router';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import type { TrackPlaylistRef } from '@/store/playlistMembershipIndex';
import { TrackPlaylistMembershipCell } from './TrackPlaylistMembershipCell';

const memberships: readonly TrackPlaylistRef[] = [
  { id: 'focus', serverId: 'srv-1', name: 'psy-smart-Focus' },
  { id: 'road', serverId: 'srv-1', name: 'Road Trip' },
  { id: 'workout', serverId: 'srv-1', name: 'Workout' },
];

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.search}</div>;
}

function renderCell(
  truthState: 'unknown' | 'loading' | 'ready' | 'partial' = 'ready',
  values: readonly TrackPlaylistRef[] = memberships,
  onPlaylistContextMenu = vi.fn(),
) {
  const view = renderWithProviders(
    <>
      <TrackPlaylistMembershipCell
        memberships={values}
        truthState={truthState}
        onPlaylistContextMenu={onPlaylistContextMenu}
      />
      <LocationProbe />
    </>,
  );
  return { ...view, onPlaylistContextMenu };
}

describe('TrackPlaylistMembershipCell', () => {
  it('shows one direct playlist and counts all remaining known memberships', () => {
    renderCell();

    expect(screen.getByRole('button', { name: 'Focus' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /\+2/ })).toHaveTextContent('[+2]');
    expect(screen.queryByText('Road Trip')).not.toBeInTheDocument();
    expect(screen.queryByText('Workout')).not.toBeInTheDocument();
  });

  it('navigates the visible playlist with owning-server scope', () => {
    renderCell();

    fireEvent.click(screen.getByRole('button', { name: 'Focus' }));

    expect(screen.getByTestId('location')).toHaveTextContent(
      '/playlists/focus?server=srv-1',
    );
  });

  it('routes right-click on the visible playlist to the membership callback', () => {
    const { onPlaylistContextMenu } = renderCell();

    fireEvent.contextMenu(
      screen.getByRole('button', { name: 'Focus' }),
      { clientX: 41, clientY: 73 },
    );

    expect(onPlaylistContextMenu).toHaveBeenCalledTimes(1);
    expect(onPlaylistContextMenu.mock.calls[0]?.[1]).toEqual(
      memberships[0],
    );
    expect(onPlaylistContextMenu.mock.calls[0]?.[0]).toMatchObject({
      clientX: 41,
      clientY: 73,
    });
  });

  it('routes right-click from an overflow playlist and closes the popover', () => {
    const { onPlaylistContextMenu } = renderCell();

    fireEvent.click(screen.getByRole('button', { name: /\+2/ }));
    fireEvent.contextMenu(
      screen.getByRole('button', { name: 'Road Trip' }),
      { clientX: 22, clientY: 35 },
    );

    expect(onPlaylistContextMenu).toHaveBeenCalledTimes(1);
    expect(onPlaylistContextMenu.mock.calls[0]?.[1]).toEqual(
      memberships[1],
    );
    expect(
      screen.queryByRole('dialog', { name: 'Playlists' }),
    ).not.toBeInTheDocument();
  });

  it('opens the remaining memberships in a portal and navigates from it', () => {
    renderCell();

    const more = screen.getByRole('button', { name: /\+2/ });
    fireEvent.click(more);

    const dialog = screen.getByRole('dialog', { name: 'Playlists' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Road Trip' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Workout' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Workout' }));

    expect(screen.getByTestId('location')).toHaveTextContent(
      '/playlists/workout?server=srv-1',
    );
    expect(screen.queryByRole('dialog', { name: 'Playlists' })).not.toBeInTheDocument();
  });

  it('closes on Escape and restores focus to the [+N] trigger', () => {
    renderCell();

    const more = screen.getByRole('button', { name: /\+2/ });
    fireEvent.click(more);
    expect(screen.getByRole('dialog', { name: 'Playlists' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'Playlists' })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(more);
  });

  it('keeps incomplete truth explicit without inflating the [+N] count', () => {
    renderCell('partial');

    expect(screen.getByRole('button', { name: 'Focus' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /\+2/ })).toHaveTextContent('[+2]');
    expect(screen.getByText('…')).toBeInTheDocument();
  });

  it('uses an em dash only for ready empty membership', () => {
    const { rerender } = renderCell('ready', []);
    expect(screen.getByText('—')).toBeInTheDocument();

    rerender(
      <>
        <TrackPlaylistMembershipCell
          memberships={[]}
          truthState="partial"
        />
        <LocationProbe />
      </>,
    );
    expect(screen.queryByText('—')).not.toBeInTheDocument();
    expect(screen.getByText('…')).toBeInTheDocument();
  });
});
