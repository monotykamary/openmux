import type { DesktopNotification } from "../terminal/command-parser";

export type PtyNotificationEvent = {
  ptyId: string;
  notification: DesktopNotification;
  subtitle?: string;
};

export type NotificationForwarder = (event: PtyNotificationEvent) => void;

let notificationForwarder: NotificationForwarder | null = null;

export function setNotificationForwarder(forwarder: NotificationForwarder | null): void {
  notificationForwarder = forwarder;
}

export function forwardNotification(event: PtyNotificationEvent): boolean {
  if (!notificationForwarder) return false;
  notificationForwarder(event);
  return true;
}
