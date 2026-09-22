export const MESSAGE_EDIT_WINDOW_MS = 30 * 60_000;

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
