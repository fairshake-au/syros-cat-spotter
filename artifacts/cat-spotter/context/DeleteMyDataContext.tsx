import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import {
  deleteMyData as deleteMyDataRequest,
  getClaimedUsername,
  setIdentityDeletedHandler,
} from '@workspace/api-client-react';
import {
  deleteMyDataWithReports,
  finishAfterServerDeleted,
  isIdentityDeletedError,
  type DeleteMyDataSteps,
  type DeleteOutcome,
  type ReportChoice,
} from '@/lib/deleteMyData';
import { readStoredDeviceId, useDevice } from './DeviceContext';
import { useOffline } from './OfflineContext';
import { useReportQueue } from './ReportQueueContext';

/**
 * "Delete my data" for the whole app (SYC-63). Owns the deletion itself, and
 * the "Done" screen that follows it: the root gate shows that screen (not the
 * new-spotter first-run step) until the person taps on, because clearing the
 * username would otherwise swap the app out from under the confirmation
 * screen before "Done" could appear.
 */
interface DeleteMyDataValue {
  /**
   * Runs the whole flow. Never throws. `reports` is the person's choice
   * about cat reports still waiting on the phone (SYC-234).
   */
  deleteNow: (reports?: ReportChoice) => Promise<DeleteOutcome>;
  /** True from the moment the phone starts becoming a new spotter, until dismissed. */
  doneVisible: boolean;
  dismissDone: () => void;
}

/**
 * "Delete it too", saved before the server is asked, so a finish that
 * happens later (the app killed after the server's answer, plan §6.4) still
 * deletes the waiting cat reports the person chose to delete, instead of
 * sending them under the new spotter (#97 review, finding 5).
 */
const DELETE_REPORTS_KEY = 'cat-spotter/delete-my-data-reports';

const DeleteMyDataContext = createContext<DeleteMyDataValue>({
  deleteNow: async () => 'failed',
  doneVisible: false,
  dismissDone: () => {},
});

export function DeleteMyDataProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const device = useDevice();
  const offline = useOffline();
  const reportQueue = useReportQueue();
  const reportQueueRef = useRef(reportQueue);
  reportQueueRef.current = reportQueue;
  const [doneVisible, setDoneVisible] = useState(false);

  // The latest values, for callbacks registered once (the 410 handler).
  const deviceIdRef = useRef(device.deviceId);
  deviceIdRef.current = device.deviceId;
  const busyRef = useRef(false);

  const stepsRef = useRef<Omit<DeleteMyDataSteps, 'deleteOnServer'>>(null!);
  stepsRef.current = {
    pauseSync: offline.pauseSync,
    resumeSync: offline.resumeSync,
    wipePhone: async () => {
      await offline.wipeQueue();
      if ((await AsyncStorage.getItem(DELETE_REPORTS_KEY)) === 'delete') {
        await reportQueueRef.current.wipeReports();
      }
      // Profile, notifications, anything fetched with the old id.
      queryClient.clear();
    },
    resetIdentity: async () => {
      // Shown before the username clears, so the gate goes straight to
      // "Done" rather than flashing the first-run step.
      setDoneVisible(true);
      try {
        await device.resetIdentity();
      } catch (err) {
        setDoneVisible(false);
        throw err;
      }
    },
  };

  const deleteNow = useCallback(async (reports: ReportChoice = 'none'): Promise<DeleteOutcome> => {
    const deviceId = deviceIdRef.current;
    if (!deviceId || busyRef.current) return 'failed';
    busyRef.current = true;
    let outcome: DeleteOutcome = 'failed';
    try {
      if (reports === 'delete') await AsyncStorage.setItem(DELETE_REPORTS_KEY, 'delete');
      outcome = await deleteMyDataWithReports(
        {
          ...stepsRef.current,
          deleteOnServer: () =>
            deleteMyDataRequest({ headers: { 'X-Device-Id': deviceId } }),
          sendReports: () => reportQueueRef.current.sendAllNow(),
          wipeReports: () => reportQueueRef.current.wipeReports(),
        },
        reports,
      );
      return outcome;
    } catch {
      return 'failed';
    } finally {
      // Kept only while a retry still has to finish the wipe.
      if (outcome !== 'wipe_failed') await AsyncStorage.removeItem(DELETE_REPORTS_KEY).catch(() => {});
      busyRef.current = false;
    }
  }, []);

  // Plan §6.4: an old identity is still in use somewhere (the app was killed
  // between the server's answer and the wipe, or another tab deleted it).
  // A 410 can also be a late reply to a request sent with the OLD id after
  // this phone already moved on, so check that the CURRENT identity is the
  // deleted one before wiping anything.
  useEffect(() => {
    setIdentityDeletedHandler(() => {
      const deviceId = deviceIdRef.current;
      if (!deviceId || busyRef.current) return;
      busyRef.current = true;
      void (async () => {
        try {
          await getClaimedUsername(deviceId);
          // The current identity is fine: the 410 was about an old one.
        } catch (err) {
          if (isIdentityDeletedError(err) && deviceIdRef.current === deviceId) {
            // On the web every tab shares one saved identity. If another tab
            // already became a new spotter, wiping here would erase that
            // spotter's new spots and replace it: take it up instead.
            const stored = await readStoredDeviceId();
            if (stored && stored !== deviceId) {
              if (Platform.OS === 'web' && typeof window !== 'undefined') window.location.reload();
              return;
            }
            const outcome = await finishAfterServerDeleted(stepsRef.current);
            if (outcome === 'done') await AsyncStorage.removeItem(DELETE_REPORTS_KEY);
          }
        } finally {
          busyRef.current = false;
        }
      })();
    });
    return () => setIdentityDeletedHandler(null);
  }, []);

  const dismissDone = useCallback(() => setDoneVisible(false), []);

  const value = useMemo(
    () => ({ deleteNow, doneVisible, dismissDone }),
    [deleteNow, doneVisible, dismissDone],
  );
  return (
    <DeleteMyDataContext.Provider value={value}>{children}</DeleteMyDataContext.Provider>
  );
}

export function useDeleteMyData(): DeleteMyDataValue {
  return useContext(DeleteMyDataContext);
}
