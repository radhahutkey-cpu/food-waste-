// Saves data in this browser only (no accounts, nothing sent anywhere).
// Reads and writes can fail (private window, blocked storage, full disk), so both are wrapped.

export function loadSaved<T>(key: string, fallback: T, isValid: (v: unknown) => v is T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return isValid(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

// Returns false if the browser refused to save, so the screen can say so.
export function save(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
