import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import type { AvatarProps } from './Avatar';
import type { BadgeProps } from './Badge';
import type { ButtonProps } from './Button';
import type { CardProps } from './Card';
import type { ChipProps } from './Chip';
import type { IconButtonProps } from './IconButton';
import type { InputProps } from './Input';
import type { ProgressBarProps } from './ProgressBar';
import type { StatTileProps } from './StatTile';
import type { TagProps } from './Tag';

type Equal<Actual, Expected> = (<T>() => T extends Actual ? 1 : 2) extends <
  T,
>() => T extends Expected ? 1 : 2
  ? (<T>() => T extends Expected ? 1 : 2) extends <T>() => T extends Actual ? 1 : 2
    ? true
    : false
  : false;

type Expect<T extends true> = T;
type ViewStyleProp = StyleProp<ViewStyle> | undefined;
type TextStyleProp = StyleProp<TextStyle> | undefined;

type AvatarStyleIsViewStyle = Expect<Equal<AvatarProps['style'], ViewStyleProp>>;
type BadgeStyleIsViewStyle = Expect<Equal<BadgeProps['style'], ViewStyleProp>>;
type ButtonStyleIsViewStyle = Expect<Equal<ButtonProps['style'], ViewStyleProp>>;
type CardStyleIsViewStyle = Expect<Equal<CardProps['style'], ViewStyleProp>>;
type ChipStyleIsViewStyle = Expect<Equal<ChipProps['style'], ViewStyleProp>>;
type IconButtonStyleIsViewStyle = Expect<Equal<IconButtonProps['style'], ViewStyleProp>>;
type InputStyleIsTextStyle = Expect<Equal<InputProps['style'], TextStyleProp>>;
type ProgressBarStyleIsViewStyle = Expect<Equal<ProgressBarProps['style'], ViewStyleProp>>;
type StatTileStyleIsViewStyle = Expect<Equal<StatTileProps['style'], ViewStyleProp>>;
type TagStyleIsViewStyle = Expect<Equal<TagProps['style'], ViewStyleProp>>;

export type FormControlStyleContracts =
  | AvatarStyleIsViewStyle
  | BadgeStyleIsViewStyle
  | ButtonStyleIsViewStyle
  | CardStyleIsViewStyle
  | ChipStyleIsViewStyle
  | IconButtonStyleIsViewStyle
  | InputStyleIsTextStyle
  | ProgressBarStyleIsViewStyle
  | StatTileStyleIsViewStyle
  | TagStyleIsViewStyle;