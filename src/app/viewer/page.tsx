import { Suspense } from "react";
import BadgeViewer from "@/components/badge-viewer";
export default function ViewerPage() {
  return (
    <Suspense>
      <BadgeViewer />
    </Suspense>
  );
}
