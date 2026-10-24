import { useCallback } from 'react';
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { createAudioPlayer } from 'expo-audio';
import chime from '@/assets/sounds/badge.wav';
import { useCelebrationSettings } from '@/context/CelebrationSettingsContext';

/**
 * The sound and the buzz for a badge celebration.
 *
 * Sound only plays when the spotter's sound setting is on. expo-audio's default
 * on iOS leaves the silent switch in charge (playsInSilentMode is false), so a
 * phone on silent stays silent. The buzz is native only. On the web a browser
 * may refuse to play before a tap; the button press that opened the screen
 * usually counts, and any refusal is swallowed.
 */
export function useCelebrationFeedback(): { play: () => void } {
  const { soundsOn } = useCelebrationSettings();

  const play = useCallback(() => {
    if (Platform.OS !== 'web') {
      try {
        Promise.resolve(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)).catch(() => {});
      } catch {
        // A phone without a vibration motor is fine.
      }
    }
    if (!soundsOn) return;
    try {
      const player = createAudioPlayer(chime);
      Promise.resolve(player.play()).catch(() => {});
      // The chime is under a second; free the player soon after.
      setTimeout(() => {
        try {
          player.remove();
        } catch {
          // Already gone.
        }
      }, 3000);
    } catch {
      // Autoplay refused, or no audio output: the celebration still works.
    }
  }, [soundsOn]);

  return { play };
}
