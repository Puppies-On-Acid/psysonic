import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { TrackMoodLinks } from './TrackMoodLinks';

function LocationProbe() {
  const location = useLocation();
  const state = location.state as { returnTo?: string } | null;
  return (
    <div data-testid="mood-link-location">
      {location.pathname}{location.search}|{state?.returnTo ?? ''}
    </div>
  );
}

function renderLinks(
  moods: string[],
  route = '/album/al1?server=srv-b&lossless=1',
) {
  const onNavigate = vi.fn();
  const onRowClick = vi.fn();
  const onRowMouseDown = vi.fn();
  const view = renderWithProviders(
    <div onClick={onRowClick} onMouseDown={onRowMouseDown}>
      <TrackMoodLinks song={{ moods }} onNavigate={onNavigate} />
      <LocationProbe />
    </div>,
    { route },
  );
  return { ...view, onNavigate, onRowClick, onRowMouseDown };
}

describe('TrackMoodLinks', () => {
  it('navigates to a named Mood page, preserves the return route, and does not trigger row handlers', async () => {
    const user = userEvent.setup();
    const { onNavigate, onRowClick, onRowMouseDown } = renderLinks(['Dark & Dreamy']);
    await user.click(screen.getByRole('button', { name: 'Dark & Dreamy' }));

    expect(onNavigate).toHaveBeenCalledOnce();
    expect(onRowClick).not.toHaveBeenCalled();
    expect(onRowMouseDown).not.toHaveBeenCalled();
    expect(screen.getByTestId('mood-link-location')).toHaveTextContent(
      '/moods/Dark%20%26%20Dreamy|/album/al1?server=srv-b&lossless=1',
    );
  });

  it('keeps every distinct mood visible in original order with middle-dot separators', async () => {
    const user = userEvent.setup();
    const { container } = renderLinks([
      ' Atmospheric ', 'atmospheric', 'Melancholic', '', '  ', 'Ethereal',
    ]);

    expect(container.querySelector('.track-moods-cell')).toHaveTextContent(
      'Atmospheric · Melancholic · Ethereal',
    );
    expect(screen.getAllByRole('button')).toHaveLength(3);

    await user.click(screen.getByRole('button', { name: 'Ethereal' }));
    expect(screen.getByTestId('mood-link-location')).toHaveTextContent(
      '/moods/Ethereal|/album/al1?server=srv-b&lossless=1',
    );
  });

  it('supports keyboard activation of each individual mood link', async () => {
    const user = userEvent.setup();
    renderLinks(['Love', 'Emotional'], '/album/al1');
    const second = screen.getByRole('button', { name: 'Emotional' });
    second.focus();
    await user.keyboard('{Enter}');

    expect(screen.getByTestId('mood-link-location')).toHaveTextContent(
      '/moods/Emotional|/album/al1',
    );
  });

  it('does not generate links for absent file moods', () => {
    const { container } = renderLinks([]);
    expect(container.querySelector('.track-moods-cell')).toBeNull();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
