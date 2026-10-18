import * as ImageManipulator from 'expo-image-manipulator';

/** SYC-415 spec §6.1: extras are prepared to the server's stored size and quality. */
const LONG_SIDE = 2048;
const QUALITY = 0.8;

/**
 * Prepares an extra (face/body) photo for sending: at most 2048px on the long
 * side, re-encoded as JPEG at quality 0.8, with its base64.
 *
 * Returns null when the photo can't be prepared (for example an iPhone HEIC
 * photo the web build can't decode). The caller refuses the photo at pick time
 * on null (spec §4.3, §6.1), so nothing un-sendable reaches the queue.
 */
export async function prepareExtraPhoto(uri: string): Promise<{ uri: string; base64: string } | null> {
  try {
    const source = await ImageManipulator.manipulateAsync(uri, [], {});
    const { width, height } = source;
    const actions: ImageManipulator.Action[] = [];
    if (width >= height && width > LONG_SIDE) actions.push({ resize: { width: LONG_SIDE } });
    else if (height > width && height > LONG_SIDE) actions.push({ resize: { height: LONG_SIDE } });
    const result = await ImageManipulator.manipulateAsync(uri, actions, {
      compress: QUALITY,
      format: ImageManipulator.SaveFormat.JPEG,
      base64: true,
    });
    if (!result.base64) return null;
    return { uri: result.uri, base64: result.base64 };
  } catch {
    return null;
  }
}
