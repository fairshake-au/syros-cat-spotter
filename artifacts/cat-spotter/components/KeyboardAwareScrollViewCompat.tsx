import { Platform, ScrollView, ScrollViewProps, View } from 'react-native';
import {
  KeyboardAwareScrollView,
  KeyboardAwareScrollViewProps,
  KeyboardStickyView,
  KeyboardStickyViewProps,
} from 'react-native-keyboard-controller';

type Props = KeyboardAwareScrollViewProps & ScrollViewProps;

export function KeyboardAwareScrollViewCompat({
  children,
  keyboardShouldPersistTaps = 'handled',
  ...props
}: Props) {
  if (Platform.OS === 'web') {
    return (
      <ScrollView
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        {...props}
      >
        {children}
      </ScrollView>
    );
  }
  return (
    <KeyboardAwareScrollView
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      {...props}
    >
      {children}
    </KeyboardAwareScrollView>
  );
}

/**
 * SYC-524: a footer that rides above the keyboard on iPhone and Android, so a
 * screen's main button stays visible while typing. Pair it with
 * KeyboardAwareScrollViewCompat's `bottomOffset` (the footer's height) so the
 * focused box isn't hidden behind it. The website's browser moves the page
 * itself, so there it is a plain View.
 */
export function KeyboardStickyViewCompat({ children, offset, ...props }: KeyboardStickyViewProps) {
  if (Platform.OS === 'web') return <View {...props}>{children}</View>;
  return (
    <KeyboardStickyView offset={offset} {...props}>
      {children}
    </KeyboardStickyView>
  );
}
