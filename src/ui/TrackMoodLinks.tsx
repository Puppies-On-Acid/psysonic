import { Fragment } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { SubsonicSong } from '@/lib/api/subsonicTypes';
import { moodTagsFor } from '@/lib/format/playlistDetailHelpers';

interface Props {
  song: Pick<SubsonicSong, 'moods'>;
  /** A parent modal can close itself before the route changes. */
  onNavigate?: () => void;
}

/** Each native file MOOD/TMOO value links to its Mood Detail route. */
export function TrackMoodLinks({ song, onNavigate }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const moods = moodTagsFor(song);

  if (moods.length === 0) return null;

  const returnTo = location.pathname + location.search + location.hash;
  const goToMood = (mood: string) => {
    onNavigate?.();
    navigate('/moods/' + encodeURIComponent(mood), {
      state: { returnTo },
    });
  };

  return (
    <span className="track-moods-cell">
      {moods.map((mood, index) => (
        <Fragment key={mood}>
          {index > 0 && <span aria-hidden="true">{' · '}</span>}
          <button
            type="button"
            className="track-mood-link"
            title={mood}
            onMouseDown={event => event.stopPropagation()}
            onClick={event => {
              event.stopPropagation();
              goToMood(mood);
            }}
          >
            {mood}
          </button>
        </Fragment>
      ))}
    </span>
  );
}
