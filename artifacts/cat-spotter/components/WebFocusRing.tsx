import { useEffect } from 'react';
import { Platform } from 'react-native';
import { useColors } from '@/hooks/useColors';

/**
 * One designed keyboard focus ring for the web build (SYC-815), matching the
 * dashboard's 3px outline with a 2px gap. The paper halo keeps it visible on
 * blue fills. `:where` adds no specificity, so a text box that draws its own
 * focused border can still turn the ring off with `outlineStyle: 'none'`.
 */
export function WebFocusRing() {
  const colors = useColors();
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const style = document.createElement('style');
    style.setAttribute('data-cs-focus-ring', '');
    style.textContent =
      `:where(:focus-visible){outline:3px solid ${colors.primary};outline-offset:2px}` +
      `:where(:focus-visible:not(input,textarea)){box-shadow:0 0 0 2px ${colors.card}}`;
    document.head.appendChild(style);
    return () => style.remove();
  }, [colors.primary, colors.card]);
  return null;
}
