import type { DesktopNotification } from "./command-parser";
import { getHostCapabilities } from "./capabilities";
import { hasHostSequenceWriter, writeHostSequence } from "./host-output";

const DESKTOP_NOTIFICATIONS_ENV = "OPENMUX_DESKTOP_NOTIFICATIONS";
const DESKTOP_NOTIFICATION_SOUND_ENV = "OPENMUX_NOTIFICATION_SOUND";
const DEFAULT_NOTIFICATION_TITLE = "openmux";
const OSC_ESCAPE = "\x1b";
const OSC_BEL = "\x07";

function desktopNotificationsEnabled(): boolean {
  if (process.platform !== "darwin") return false;
  const raw = (process.env[DESKTOP_NOTIFICATIONS_ENV] ?? "").toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return true;
}

function hostNotificationEnabled(): boolean {
  if (!hasHostSequenceWriter()) {
    const stdout = process.stdout;
    if (!stdout || !stdout.isTTY) return false;
  }
  const caps = getHostCapabilities();
  const hintParts = [
    caps?.terminalName,
    process.env.OPENMUX_HOST_TERMINAL,
    process.env.TERM_PROGRAM,
    process.env.TERM,
  ];
  const hint = hintParts.filter(Boolean).join(" ").toLowerCase();
  return hint.includes("ghostty");
}

function sanitizeOscPayload(text: string): string {
  return text.replace(/[\x00-\x1f\x7f]/g, "");
}

function buildOscPayload(title: string, body: string): string | null {
  const safeTitle = sanitizeOscPayload(title.trim());
  const safeBody = sanitizeOscPayload(body.trim());
  if (!safeBody) return null;
  if (!safeTitle) return safeBody;
  return `${safeTitle};${safeBody}`;
}

function buildOscSequence(notification: DesktopNotification): string | null {
  const payload = buildOscPayload(notification.title, notification.body);
  if (!payload) return null;
  if (notification.source === "osc777") {
    return `${OSC_ESCAPE}]777;notify;${payload}${OSC_BEL}`;
  }
  return `${OSC_ESCAPE}]9;${payload}${OSC_BEL}`;
}

export function sendHostNotification(notification: DesktopNotification): boolean {
  if (!hostNotificationEnabled()) return false;
  const sequence = buildOscSequence(notification);
  if (!sequence) return false;
  return writeHostSequence(sequence);
}

export function sendMacOsNotification(params: { title: string; subtitle?: string; body: string }): void {
  if (!desktopNotificationsEnabled()) return;
  if (typeof Bun === "undefined" || typeof Bun.spawn !== "function") return;

  const title = params.title.trim() || DEFAULT_NOTIFICATION_TITLE;
  const body = params.body.trim();
  if (!body) return;

  const subtitle = params.subtitle?.trim() ?? "";
  const sound = (process.env[DESKTOP_NOTIFICATION_SOUND_ENV] ?? "Glass").trim();

  const script = `on run argv
  set theTitle to item 1 of argv
  set theSubtitle to item 2 of argv
  set theBody to item 3 of argv
  set theSound to item 4 of argv

  if theSubtitle is "" then
    if theSound is "" then
      display notification theBody with title theTitle
    else
      display notification theBody with title theTitle sound name theSound
    end if
  else
    if theSound is "" then
      display notification theBody with title theTitle subtitle theSubtitle
    else
      display notification theBody with title theTitle subtitle theSubtitle sound name theSound
    end if
  end if
end run`;

  try {
    const proc = Bun.spawn(
      ["osascript", "-e", script, "--", title, subtitle, body, sound],
      { stdout: "ignore", stderr: "ignore" }
    );
    proc.exited.catch(() => {});
  } catch {
    // Ignore notification failures (e.g., missing osascript)
  }
}

export function sendDesktopNotification(params: {
  notification: DesktopNotification;
  subtitle?: string;
}): boolean {
  if (sendHostNotification(params.notification)) {
    return true;
  }
  sendMacOsNotification({
    title: params.notification.title,
    subtitle: params.subtitle,
    body: params.notification.body,
  });
  return true;
}
