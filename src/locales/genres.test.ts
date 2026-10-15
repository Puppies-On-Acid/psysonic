import { describe, expect, it } from 'vitest';

import i18n, { SUPPORTED_LANGUAGE_CODES } from '@/lib/i18n';

describe('genre detail translations', () => {
  it('keeps the genre detail tab keys present in every shipped locale', () => {
    const keys = [
      'genres.tracksEmpty',
      'genres.viewTabsLabel',
    ];

    for (const lng of SUPPORTED_LANGUAGE_CODES) {
      for (const key of keys) {
        expect(
          i18n.getResource(lng, 'translation', key),
          `${lng}: ${key}`,
        ).toBeTruthy();
      }
    }
  });
});
