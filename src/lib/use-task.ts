"use client";

import { useRef, useState } from "react";

/** One in-flight UI action; the label and error belong to the same operation. */
export function useTask() {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const lock = useRef(false);
  async function run(label: string, action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(label);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not finish this step. Try again.");
    } finally {
      lock.current = false;
      setBusy("");
    }
  }
  return { busy, error, setError, run };
}
