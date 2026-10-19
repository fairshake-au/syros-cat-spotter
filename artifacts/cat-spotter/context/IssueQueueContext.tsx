import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { reportIssue } from '@workspace/api-client-react';
import { createQueueStore, type QueueStore } from '@/lib/queueStore';
import {
  clearIssueWaits,
  isPendingIssue,
  newPendingIssue,
  syncIssues,
  type IssueApi,
  type IssueReason,
  type PendingIssue,
} from '@/lib/issueQueue';
import { REMINDER_AFTER_MS, dueReminders, requeueFailed, type ReportLanguage } from '@/lib/reportQueue';
import { createSendGate } from '@/lib/foregroundGate';
import { cancelNativeReminder, scheduleNativeReminder } from '@/lib/nativeReminder';
import { getTurnstileToken } from '@/lib/turnstile';
import { isScriptBlocked } from '@/lib/challengeUnavailable';
import { ifLockFree, withLock } from '@/lib/webLocks';
import { useDevice } from './DeviceContext';
import { useLanguage } from './LanguageContext';

/**
 * The "Report an issue" saved list, for the whole app (SYC-44 PR 6.2; spec
 * report-an-issue.md §4.2). The same shape as the cat-report queue
 * (ReportQueueContext): saved first, sent whenever there's a connection by
 * whichever tab holds the upload lock, only while the app is in the
 * foreground (each send needs a fresh safety check, C9), and one reminder
 * 24 hours on. Its own key and locks, so the two lists never touch.
 */

const ISSUE_QUEUE_KEY = 'cat-spotter/pending-issues';
const ISSUE_QUEUE_LOCK = 'cat-spotter-issue-queue';
const ISSUE_UPLOAD_LOCK = 'cat-spotter-issue-upload';

export interface NewIssueInput {
  reason: IssueReason;
  catId: number;
  photoPublicId?: string | null;
  note: string;
  language: ReportLanguage;
}

interface IssueQueueValue {
  ready: boolean;
  issues: PendingIssue[];
  /** The server's answers this session, by local id: what it did (`hidden`). */
  replies: ReadonlyMap<string, { hidden: boolean }>;
  syncing: boolean;
  /** Save first; then try to send. Resolves with the saved report's local id. */
  submitIssue: (input: NewIssueInput) => Promise<string>;
  syncNow: () => Promise<void>;
  retryFailed: () => Promise<void>;
  /** The one "hasn't sent yet" reminder, for the web. */
  reminderVisible: boolean;
  dismissReminder: () => void;
  /** "Delete my data": try to send every waiting report now. True once none is left. */
  sendAllNow: () => Promise<boolean>;
  /** "Delete my data": forget every waiting report. */
  wipeIssues: () => Promise<void>;
}

const IssueQueueContext = createContext<IssueQueueValue | undefined>(undefined);

const api: IssueApi = {
  submit: async (body) => {
    const reply = await reportIssue(body);
    return { publicId: reply.publicId, hidden: reply.hidden === true };
  },
};

export function IssueQueueProvider({ children }: { children: React.ReactNode }) {
  const { deviceId } = useDevice();
  const { t } = useLanguage();
  const [issues, setIssues] = useState<PendingIssue[]>([]);
  const [ready, setReady] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [replies, setReplies] = useState<ReadonlyMap<string, { hidden: boolean }>>(new Map());
  const [reminderVisible, setReminderVisible] = useState(false);

  const storeRef = useRef<QueueStore<PendingIssue> | null>(null);
  if (!storeRef.current) {
    storeRef.current = createQueueStore<PendingIssue>({
      read: () => AsyncStorage.getItem(ISSUE_QUEUE_KEY),
      write: (raw) => AsyncStorage.setItem(ISSUE_QUEUE_KEY, raw),
      remove: () => AsyncStorage.removeItem(ISSUE_QUEUE_KEY),
      withLock: (fn) => withLock(ISSUE_QUEUE_LOCK, fn),
      publish: setIssues,
      isItem: isPendingIssue,
    });
  }
  const store = storeRef.current;
  const syncingRef = useRef(false);
  const syncInFlightRef = useRef<Promise<void> | null>(null);
  const againRef = useRef(false);
  const tRef = useRef(t);
  tRef.current = t;

  const syncNow = useCallback(async (): Promise<void> => {
    if (!deviceId) return;
    if (syncingRef.current) {
      againRef.current = true;
      return;
    }
    await store.ready;
    if (!store.items().some((r) => r.status === 'queued')) return;
    syncingRef.current = true;
    setSyncing(true);
    let settle!: () => void;
    syncInFlightRef.current = new Promise<void>((resolve) => {
      settle = resolve;
    });
    try {
      await ifLockFree(ISSUE_UPLOAD_LOCK, () =>
        syncIssues(store, {
          api,
          deviceId,
          // A fresh safety-check token for every send (action report_issue).
          getToken: getTurnstileToken,
          scriptBlocked: isScriptBlocked,
          onAccepted: (localId, reply) => {
            setReplies((prev) => new Map(prev).set(localId, { hidden: reply.hidden }));
            const item = store.items().find((r) => r.localId === localId);
            void cancelNativeReminder(item?.nativeReminderId);
          },
        }),
      );
    } catch {
      // Never leave a rejection behind; the next trigger tries again.
    } finally {
      syncingRef.current = false;
      syncInFlightRef.current = null;
      settle();
      setSyncing(false);
    }
    if (againRef.current) {
      againRef.current = false;
      await syncNow();
    }
  }, [deviceId, store]);

  const checkReminders = useCallback(async () => {
    await store.ready;
    const due = dueReminders(store.items(), new Date());
    if (!due.length) return;
    setReminderVisible(true);
    const ids = new Set(due.map((r) => r.localId));
    const at = new Date().toISOString();
    await store
      .mutate((list) => list.map((r) => (ids.has(r.localId) ? { ...r, remindedAt: at } : r)), 'system')
      .catch(() => undefined);
  }, [store]);

  // A send needs a safety check, so it only starts in the foreground (C9).
  const syncNowRef = useRef(syncNow);
  syncNowRef.current = syncNow;
  const gateRef = useRef<ReturnType<typeof createSendGate> | null>(null);
  if (!gateRef.current) {
    gateRef.current = createSendGate({
      state: () => AppState.currentState,
      send: () => void syncNowRef.current(),
    });
  }
  const gate = gateRef.current;

  useEffect(() => {
    store.load().then(() => {
      setReady(true);
      void checkReminders();
      gate.trigger();
    });
  }, [store, gate, checkReminders]);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      if (state.isConnected) gate.trigger();
    });
    const sub = AppState.addEventListener?.('change', (s) => {
      if (s === 'active') {
        void checkReminders();
        gate.trigger(s);
      }
    });
    const timer = setInterval(() => gate.trigger(), 60_000);
    return () => {
      unsubscribe();
      sub?.remove?.();
      clearInterval(timer);
    };
  }, [gate, checkReminders]);

  const submitIssue = useCallback(
    async (input: NewIssueInput) => {
      await store.ready;
      const item = newPendingIssue(input);
      item.nativeReminderId = await scheduleNativeReminder(
        tRef.current('issueReminder'),
        new Date(Date.now() + REMINDER_AFTER_MS),
      );
      await store.mutate((list) => [...list, item]);
      // Sent at once while the app is open (the person is looking at it).
      void syncNow();
      return item.localId;
    },
    [store, syncNow],
  );

  const retryFailed = useCallback(async () => {
    await store.ready;
    await store.mutate(requeueFailed, 'user').catch(() => undefined);
    await syncNow();
  }, [store, syncNow]);

  const sendAllNow = useCallback(async (): Promise<boolean> => {
    await store.ready;
    await store.mutate(requeueFailed, 'user').catch(() => undefined);
    await store.mutate(clearIssueWaits, 'user').catch(() => undefined);
    await syncInFlightRef.current;
    await syncNow();
    return store.items().length === 0;
  }, [store, syncNow]);

  const wipeIssues = useCallback(async () => {
    await store.ready;
    const items = store.items();
    await store.wipe();
    await Promise.all(items.map((r) => cancelNativeReminder(r.nativeReminderId)));
    setReminderVisible(false);
  }, [store]);

  const value = useMemo<IssueQueueValue>(
    () => ({
      ready,
      issues,
      replies,
      syncing,
      submitIssue,
      syncNow,
      retryFailed,
      reminderVisible,
      dismissReminder: () => setReminderVisible(false),
      sendAllNow,
      wipeIssues,
    }),
    [ready, issues, replies, syncing, submitIssue, syncNow, retryFailed, reminderVisible, sendAllNow, wipeIssues],
  );

  return <IssueQueueContext.Provider value={value}>{children}</IssueQueueContext.Provider>;
}

export function useIssueQueue(): IssueQueueValue {
  const ctx = useContext(IssueQueueContext);
  if (!ctx) throw new Error('useIssueQueue must be used within IssueQueueProvider');
  return ctx;
}
