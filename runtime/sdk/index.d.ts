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
