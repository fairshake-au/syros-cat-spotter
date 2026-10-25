// @vitest-environment jsdom
/**
 * SYC-706: the Spotters summary card lines. Usernames are user text, so a name
 * with replace patterns in it ($&) must show literally.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useColors', () => ({
  useColors: () => new Proxy({}, { get: () => '#123456' }),
}));
vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('@/components/purropolis', () => ({ Button: () => null }));
vi.mock('@/context/OfflineContext', () => ({ useOffline: () => ({ isOnline: true }) }));
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ t: (k: string) => k, language: 'en' }) }));

import { summaryText } from '../profile/SpottersTab';
import { TRANSLATIONS } from '@/lib/i18n';

const t = (k: string) => TRANSLATIONS.en[k] ?? k;
const rank = (n: number) => `#${n}`;

describe('summaryText with a name containing $&', () => {
  for (const week of [false, true]) {
    it(`level line keeps the name literal (week=${week})`, () => {
      const [, second] = summaryText({ kind: 'level', rank: 2, points: 40, name: 'A$&B' } as never, t, rank, week);
      expect(second).toContain('A$&B');
    });
    it(`pass line keeps the name literal (week=${week})`, () => {
      const [, second] = summaryText({ kind: 'behind', rank: 5, points: 10, gap: 3, name: 'A$&B' } as never, t, rank, week);
      expect(second).toContain('A$&B');
    });
  }
});
