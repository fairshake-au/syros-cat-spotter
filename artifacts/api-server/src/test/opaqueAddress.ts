// The K13 scans (no coordinate or z/x/y in any href, action, src or
// redirect) look for digit-dash-digit runs. One kind of address is opaque by
// design and can contain such runs by chance: a photo's uuid. An address is
// set aside only if it is exactly that shape, so a coordinate can't hide
// behind it. (The old map-picture tokens went with the picture map, SYC-705
// 2b.8; nothing writes those addresses any more.)
const PHOTO = /^\/api\/(team\/)?photos\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isOpaqueAddress(v: string): boolean {
  return PHOTO.test(v);
}
