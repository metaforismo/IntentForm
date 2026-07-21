export const STUDIO_BOOT_NOTICE_KEY = "intentform-studio-boot-notice";

const MAX_NOTICE_LENGTH = 500;

/** Persist a Studio restore failure so the launcher can explain the redirect. */
export function stashBootNotice(storage: Pick<Storage, "setItem">, message: string): void {
  try {
    storage.setItem(STUDIO_BOOT_NOTICE_KEY, message.slice(0, MAX_NOTICE_LENGTH));
  } catch {
    // A private-mode quota must not block the redirect itself.
  }
}

/** Read and clear the pending boot notice; returns null when none is stashed. */
export function takeBootNotice(storage: Pick<Storage, "getItem" | "removeItem">): string | null {
  try {
    const message = storage.getItem(STUDIO_BOOT_NOTICE_KEY);
    if (message !== null) storage.removeItem(STUDIO_BOOT_NOTICE_KEY);
    return message && message.trim() ? message.slice(0, MAX_NOTICE_LENGTH) : null;
  } catch {
    return null;
  }
}
