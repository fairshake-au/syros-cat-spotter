import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { customFetch } from '@workspace/api-client-react';
import {
  deletePendingPhoto,
  readPendingPhoto,
  savePendingPhoto,
} from '@/lib/pendingPhotos';
import { createQueueStore, type QueueStore } from '@/lib/queueStore';
import {
  REMINDER_AFTER_MS,
  dueReminders,
  isPendingReport,
  newPendingReport,
  requeueFailed,
  reportPhotoKey,
  syncReports,
  type PendingReport,
  type ReportApi,
  type ReportLanguage,
  type ReportSeverity,
} from '@/lib/reportQueue';
import { ifLockFree, withLock } from '@/lib/webLocks';
import { useDevice } from './DeviceContext';
import { useLanguage } from './LanguageContext';

/**
 * The cat-report queue, for the whole app (SYC-42 plan, Slice 1 items
 * 1.11–1.13). Reports are saved first, then sent (text, then photo) whenever
 * there's a connection, by whichever tab holds the upload lock.
 */

const REPORT_QUEUE_KEY = 'cat-spotter/pending-reports';
const REPORT_QUEUE_LOCK = 'cat-spotter-report-queue';
const REPORT_UPLOAD_LOCK = 'cat-spotter-report-upload';

export interface NewReportInput {
  severity: ReportSeverity;
  isLitter: boolean;
  lat: number;
  lng: number;
  note: string;
  language: ReportLanguage;
  clientRef: string;
  photo: { uri: string; base64: string } | null;
}

interface ReportQueueValue {
  ready: boolean;
  reports: PendingReport[];
  /** Reports whose text the server has accepted this session. */
  acceptedIds: ReadonlySet<string>;
  syncing: boolean;
  /** Save first; then try to send. Resolves with the saved report's local id. */
  submitReport: (input: NewReportInput) => Promise<string>;
  syncNow: () => Promise<void>;
  /** Try again: put refused reports back in the queue and send. */
  retryFailed: () => Promise<void>;
  /** The one "hasn't sent yet" reminder, for the web (spec §4.3). */
  reminderVisible: boolean;
  dismissReminder: () => void;
  /** Best effort, online only: the draft the spec asks for once severity and location are set. */
  sendDraft: (input: {
    clientRef: string;
    severity: ReportSeverity;
    lat: number;
    lng: number;
    isLitter: boolean;
    language: ReportLanguage;
  }) => void;
}

const ReportQueueContext = createContext<ReportQueueValue | undefined>(undefined);

const api: ReportApi = {
  submit: (body) =>
    customFetch<{ publicId: string }>('/api/reports', {
      method: 'POST',
      body: JSON.stringify(body),
      responseType: 'json',
    }),
  uploadPhoto: async (publicId, deviceId, photoBase64) => {
    await customFetch(`/api/reports/${encodeURIComponent(publicId)}/photo`, {
      method: 'PUT',
      body: JSON.stringify({ deviceId, photoBase64 }),
      responseType: 'json',
    });
  },
};

/**
 * Phone apps: the 24-hour reminder is a local notification scheduled when
 * the report is saved, so it fires even if the app isn't opened (spec §4.3),
 * and is cancelled the moment the report's text is accepted. The website
 * can't notify when closed, so it shows a banner the next time it's opened.
 */
async function scheduleNativeReminder(title: string, at: Date): Promise<string | undefined> {
  if (Platform.OS === 'web') return undefined;
  try {
    const Notifications = await import('expo-notifications');
    return await Notifications.scheduleNotificationAsync({
      content: { title },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
    });
  } catch {
    return undefined;
  }
}

async function cancelNativeReminder(id: string | undefined): Promise<void> {
  if (!id || Platform.OS === 'web') return;
  try {
    const Notifications = await import('expo-notifications');
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    // nothing to cancel
  }
}

export function ReportQueueProvider({ children }: { children: React.ReactNode }) {
  const { deviceId } = useDevice();
  const { t } = useLanguage();
  const [reports, setReports] = useState<PendingReport[]>([]);
  const [ready, setReady] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [acceptedIds, setAcceptedIds] = useState<ReadonlySet<string>>(new Set());
  const [reminderVisible, setReminderVisible] = useState(false);

  const storeRef = useRef<QueueStore<PendingReport> | null>(null);
  if (!storeRef.current) {
    storeRef.current = createQueueStore<PendingReport>({
      read: () => AsyncStorage.getItem(REPORT_QUEUE_KEY),
      write: (raw) => AsyncStorage.setItem(REPORT_QUEUE_KEY, raw),
      withLock: (fn) => withLock(REPORT_QUEUE_LOCK, fn),
      publish: setReports,
      isItem: isPendingReport,
    });
  }
  const store = storeRef.current;
  const syncingRef = useRef(false);
  const tRef = useRef(t);
  tRef.current = t;

  const syncNow = useCallback(async () => {
    if (!deviceId || syncingRef.current) return;
    await store.ready;
    if (!store.items().some((r) => r.status !== 'failed')) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      await ifLockFree(REPORT_UPLOAD_LOCK, () =>
        syncReports(store, {
          api,
          deviceId,
          readPhoto: async (ref) => {
            const read = await readPendingPhoto(ref);
            return read.status === 'ok' ? read.base64 : null;
          },
          deletePhoto: deletePendingPhoto,
          onTextAccepted: (localId) => {
            setAcceptedIds((prev) => new Set([...prev, localId]));
            const item = store.items().find((r) => r.localId === localId);
            void cancelNativeReminder(item?.nativeReminderId);
          },
        }),
      );
    } catch {
      // Never leave a rejection behind; the next trigger tries again.
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [deviceId, store]);

  const checkReminders = useCallback(async () => {
    await store.ready;
    const due = dueReminders(store.items(), new Date());
    if (!due.length) return;
    // Once per report. On the phone the scheduled notification has already
    // fired; the banner is the website's reminder (and a harmless repeat on
    // a phone whose notifications are switched off).
    setReminderVisible(true);
    const ids = new Set(due.map((r) => r.localId));
    const at = new Date().toISOString();
    await store
      .mutate(
        (list) => list.map((r) => (ids.has(r.localId) ? { ...r, remindedAt: at } : r)),
        'system',
      )
      .catch(() => undefined);
  }, [store]);

  useEffect(() => {
    store.load().then(() => {
      setReady(true);
      void checkReminders();
      void syncNow();
    });
  }, [store, syncNow, checkReminders]);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      if (state.isConnected) void syncNow();
    });
    const sub = AppState.addEventListener?.('change', (s) => {
      if (s === 'active') {
        void checkReminders();
        void syncNow();
      }
    });
    // Belt and braces: a weak signal may not flip NetInfo at all.
    const timer = setInterval(() => void syncNow(), 60_000);
    return () => {
      unsubscribe();
      sub?.remove?.();
      clearInterval(timer);
    };
  }, [syncNow, checkReminders]);

  const submitReport = useCallback(
    async (input: NewReportInput) => {
      await store.ready;
      const base = newPendingReport({
        severity: input.severity,
        isLitter: input.isLitter,
        lat: input.lat,
        lng: input.lng,
        note: input.note,
        language: input.language,
        hasPhoto: !!input.photo,
        clientRef: input.clientRef,
      });
      let item: PendingReport = base;
      if (input.photo) {
        const saved = await savePendingPhoto(
          reportPhotoKey(base.localId),
          input.photo.uri,
          input.photo.base64,
        );
        item = saved.ok
          ? { ...base, photoRef: saved.ref }
          : { ...base, photoBase64: input.photo.base64 };
      }
      item.nativeReminderId = await scheduleNativeReminder(
        tRef.current('reportReminder'),
        new Date(Date.now() + REMINDER_AFTER_MS),
      );
      try {
        await store.mutate((list) => [...list, item]);
      } catch {
        // Couldn't save it with the photo inline (storage full): save the
        // report without the photo rather than not at all. Nothing blocks
        // the report itself.
        const textOnly = { ...base, hasPhoto: false };
        await store.mutate((list) => [...list, textOnly]);
      }
      void syncNow();
      return base.localId;
    },
    [store, syncNow],
  );

  const retryFailed = useCallback(async () => {
    await store.ready;
    await store.mutate(requeueFailed, 'user').catch(() => undefined);
    await syncNow();
  }, [store, syncNow]);

  const sendDraft = useCallback<ReportQueueValue['sendDraft']>(
    (input) => {
      if (!deviceId) return;
      void customFetch('/api/reports/draft', {
        method: 'POST',
        body: JSON.stringify({ ...input, deviceId }),
      }).catch(() => undefined);
    },
    [deviceId],
  );

  const value = useMemo<ReportQueueValue>(
    () => ({
      ready,
      reports,
      acceptedIds,
      syncing,
      submitReport,
      syncNow,
      retryFailed,
      reminderVisible,
      dismissReminder: () => setReminderVisible(false),
      sendDraft,
    }),
    [ready, reports, acceptedIds, syncing, submitReport, syncNow, retryFailed, reminderVisible, sendDraft],
  );

  return <ReportQueueContext.Provider value={value}>{children}</ReportQueueContext.Provider>;
}

export function useReportQueue(): ReportQueueValue {
  const ctx = useContext(ReportQueueContext);
  if (!ctx) throw new Error('useReportQueue must be used within ReportQueueProvider');
  return ctx;
}
