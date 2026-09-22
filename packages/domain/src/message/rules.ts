export const MESSAGE_EDIT_WINDOW_MS = 30 * 60_000;
export const MESSAGE_MAX_UTF8_BYTES = 8_192;
export const NICKNAME_MAX_UTF8_BYTES = 256;
export const MESSAGE_HISTORY_DEFAULT_LIMIT = 50;
export const MESSAGE_HISTORY_MAX_LIMIT = 100;
export const MESSAGE_CHANGE_DEFAULT_LIMIT = 100;
export const MESSAGE_CHANGE_MAX_LIMIT = 200;
export const TYPING_TTL_MS = 5_000;
export const TYPING_MIN_REFRESH_MS = 2_000;
export const PRESENCE_HEARTBEAT_MIN_MS = 30_000;
export const PRESENCE_ONLINE_TTL_MS = 60_000;

export interface MessageFreezeInput {
  readonly createdAt: string;
  readonly serverSequence?: number;
}

export interface BreakupFreezeInput {
  readonly initiatedAt: string;
  readonly messageFreezeSequence?: number | null;
}

export function isMessageFrozenByBreakup(
  message: MessageFreezeInput,
  breakup: BreakupFreezeInput,
): boolean {
  if (
    breakup.messageFreezeSequence !== undefined
    && breakup.messageFreezeSequence !== null
    && message.serverSequence !== undefined
  ) {
    return message.serverSequence <= breakup.messageFreezeSequence;
  }

  return new Date(message.createdAt).getTime() < new Date(breakup.initiatedAt).getTime();
}

export function messageEditDeadline(createdAt: string): string {
  return new Date(new Date(createdAt).getTime() + MESSAGE_EDIT_WINDOW_MS).toISOString();
}

export function isMessageEditWindowOpen(createdAt: string, now: string): boolean {
  return new Date(now).getTime() < new Date(createdAt).getTime() + MESSAGE_EDIT_WINDOW_MS;
}
