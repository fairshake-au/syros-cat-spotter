// Image files imported by the app resolve to a bundled image the native and
// web <Image> components accept. Expo's own declarations live in the
// generated, uncommitted expo-env.d.ts, which CI doesn't have, so these are
// committed here (SYC-79's example photo was the first imported image).
declare module '*.jpg' {
  const source: import('react-native').ImageSourcePropType;
  export default source;
}
declare module '*.png' {
  const source: import('react-native').ImageSourcePropType;
  export default source;
}
