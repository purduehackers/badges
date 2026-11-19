/** Serialize reads and writes so reload checkpoints cannot be overtaken by autosave. */
export function browserStore(databaseName: string, storeName: string) {
  let pending: Promise<unknown> = Promise.resolve();
  async function access<T>(value: T | undefined, key: string): Promise<T | undefined> {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(storeName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error("Allow browser storage to remember your work."));
    });
    try {
      return await new Promise<T | undefined>((resolve, reject) => {
        const transaction = database.transaction(
          storeName,
          value === undefined ? "readonly" : "readwrite",
        );
        const store = transaction.objectStore(storeName);
        const request = value === undefined ? store.get(key) : store.put(value, key);
        transaction.oncomplete = () => resolve(value ?? request.result);
        transaction.onerror = transaction.onabort = () =>
          reject(new Error("Could not save your work on this computer."));
      });
    } finally {
      database.close();
    }
  }
  return function saved<T>(value?: T, key = "current"): Promise<T | undefined> {
    const operation = pending.then(() => access(value, key));
    pending = operation.catch(() => undefined);
    return operation;
  };
}

export const designDraft = browserStore("badge-designs", "drafts");
