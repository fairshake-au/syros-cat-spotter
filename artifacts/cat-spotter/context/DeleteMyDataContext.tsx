import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  deleteMyData as deleteMyDataRequest,
  getClaimedUsername,
  setIdentityDeletedHandler,
} from '@workspace/api-client-react';
import {
  deleteMyData,
  finishAfterServerDeleted,
  isIdentityDeletedError,
  type DeleteMyDataSteps,
  type DeleteOutcome,
} from '@/lib/deleteMyData';
import { useDevice } from './DeviceContext';
import { useOffline } from './OfflineContext';

/**
 * "Delete my data" for the whole app (SYC-63). Owns the deletion itself, and
 * the "Done" screen that follows it: the root gate shows that screen (not the
 * new-spotter first-run step) until the person taps on, because clearing the
 * username would otherwise swap the app out from under the confirmation
 * screen before "Done" could appear.
 */
interface DeleteMyDataValue {
  /** Runs the whole flow. Never throws. */
  deleteNow: () => Promise<DeleteOutcome>;
  /** True from the moment the phone starts becoming a new spotter, until dismissed. */
  doneVisible: boolean;
  dismissDone: () => void;
}

const DeleteMyDataContext = createContext<DeleteMyDataValue>({
  deleteNow: async () => 'failed',
  doneVisible: false,
  dismissDone: () => {},
});

export function DeleteMyDataProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const device = useDevice();
  const offline = useOffline();
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

  const deleteNow = useCallback(async (): Promise<DeleteOutcome> => {
    const deviceId = deviceIdRef.current;
    if (!deviceId || busyRef.current) return 'failed';
    busyRef.current = true;
    try {
      return await deleteMyData({
        ...stepsRef.current,
        deleteOnServer: () =>
          deleteMyDataRequest({ headers: { 'X-Device-Id': deviceId } }),
      });
    } catch {
      return 'failed';
    } finally {
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
            await finishAfterServerDeleted(stepsRef.current);
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
