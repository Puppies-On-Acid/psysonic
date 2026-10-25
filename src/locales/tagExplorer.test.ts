import { describe, expect, it } from 'vitest';

import i18n, { SUPPORTED_LANGUAGE_CODES } from '@/lib/i18n';

describe('tag Explorer translations', () => {
  it('ships the Explorer and catalog-selection keys in every locale', () => {
    const keys = [
      'tagExplorer.title',
      'tagExplorer.subtitle',
      'tagExplorer.matchMode',
      'tagExplorer.matchAny',
      'tagExplorer.matchAll',
      'tagExplorer.switchToOr',
      'tagExplorer.selectAllMatching',
      'tagExplorer.addToPlaylist',
      'tagExplorer.mixedServerPlaylist',
      'tagExplorer.largeAddTitle',
      'tagExplorer.unavailableTitle',
      'genres.selectTags',
      'genres.selectionMinimum',
      'genres.viewResults',
      'moods.selectTags',
      'moods.selectionMinimum',
      'moods.viewResults',
    ];

    for (const lng of SUPPORTED_LANGUAGE_CODES) {
      for (const key of keys) {
        expect(
          i18n.getResource(lng, 'translation', key),
          `${lng}: ${key}`,
        ).toBeTruthy();
      }

      expect(
        i18n.t('genres.selectedTagCount', {
          lng,
          count: 2,
        }),
        `${lng}: genres.selectedTagCount`,
      ).not.toContain('selectedTagCount');

      expect(
        i18n.t('tagExplorer.selectedTracks', {
          lng,
          count: 2,
        }),
        `${lng}: tagExplorer.selectedTracks`,
      ).not.toContain('selectedTracks');

      if (lng !== 'en') {
        expect(
          i18n.t('tagExplorer.title', { lng }),
          `${lng}: tagExplorer.title`,
        ).not.toBe(i18n.t('tagExplorer.title', { lng: 'en' }));
        expect(
          i18n.t('genres.selectionMinimum', { lng }),
          `${lng}: genres.selectionMinimum`,
        ).not.toBe(i18n.t('genres.selectionMinimum', { lng: 'en' }));
      }
    }
  });
});
