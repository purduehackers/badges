"use client";
import { useSearchParams } from "next/navigation";
import BadgeViewer from "./badge-viewer";
/** Preserve existing shared viewer URLs while the home page becomes the design workflow. */
export default function ViewerLink({ children }: { children: React.ReactNode }) {
  return useSearchParams().has("badge") ? <BadgeViewer /> : children;
}
