import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TRANSLATIONS, type Language } from '@/lib/i18n';
import { deviceLanguageTags, pickLanguage } from '@/lib/deviceLanguage';

const STORAGE_KEY = 'cat-spotter/language';

interface LanguageContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
  /** The stored choice (or the phone's language) has been read. */
  isLanguageReady: boolean;
}

const LanguageContext = createContext<LanguageContextValue | undefined>(
  undefined,
);

/**
 * SYC-155: a language the spotter tapped is stored and always wins. Until
 * then the app follows the phone's (or browser's) language, and that guess is
 * never stored, so it keeps following the phone.
 */
export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() =>
    pickLanguage(deviceLanguageTags()),
  );
  const [isLanguageReady, setIsLanguageReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (stored === 'en' || stored === 'el' || stored === 'fr') {
          setLanguageState(stored);
        }
      })
      .catch(() => {})
      .finally(() => setIsLanguageReady(true));
  }, []);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    AsyncStorage.setItem(STORAGE_KEY, lang);
  }, []);

  const t = useCallback(
    (key: string) => TRANSLATIONS[language][key] ?? TRANSLATIONS.en[key] ?? key,
    [language],
  );

  const value = useMemo(
    () => ({ language, setLanguage, t, isLanguageReady }),
    [language, setLanguage, t, isLanguageReady],
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider');
  return ctx;
}
