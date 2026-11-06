/** Large SVG drafts stay in IndexedDB; credentials stay in Ruby's separate localStorage entry. */
let pending: Promise<unknown> = Promise.resolve();
export function designDraft<T>(value?: T): Promise<T | undefined> {
  const operation = pending.then(() => accessDraft(value));
  pending = operation.catch(() => undefined);
  return operation;
}
async function accessDraft<T>(value?: T): Promise<T | undefined> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("badge-designs", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Allow browser storage to save your design draft."));
  });
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const transaction = database.transaction(
        "drafts",
        value === undefined ? "readonly" : "readwrite",
      );
      const store = transaction.objectStore("drafts");
      const request = value === undefined ? store.get("current") : store.put(value, "current");
      transaction.oncomplete = () => resolve(value ?? request.result);
      transaction.onerror = transaction.onabort = () =>
        reject(new Error("Could not save your design draft."));
    });
  } finally {
    database.close();
  }
}
