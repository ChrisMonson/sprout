export interface Notification {
  /** Short and specific, e.g. "Time to feed your starter". */
  title: string;
  /** Optional second line. */
  body?: string;
  /** When to show it. Omit for right away. */
  at?: Date | number;
  /** Scheduling again with the same key replaces the earlier one. */
  key?: string;
}

/**
 * Show the person a notification, now or later. It reaches them as a macOS
 * notification even when Sprout isn't open in a browser. Returns its id
 * (null outside the greenhouse, where nothing is sent).
 */
export function notify(notification: Notification): Promise<number | null>;

/** Cancel a scheduled notification by key. Returns how many were cancelled. */
export function cancelNotification(key: string): Promise<number>;

/**
 * Run a task now and then, for checks that should keep going: polling a feed,
 * sending reminders about new things. It runs soon after the server starts and
 * then every `interval` ('30s', '15m', '1h', or milliseconds). On the Mac that's
 * like setInterval. In a harvested phone app it also runs while the app is
 * closed, when Android wakes it (about every 15 minutes at most), so return a
 * promise that settles when the work is done. Returns a function that stops it.
 */
export function every(interval: string | number, task: () => unknown): () => void;
