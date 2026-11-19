import { Suspense } from "react";
import DesignWorkflow from "@/components/designs/design-workflow";
import ViewerLink from "@/components/viewer-link";
export default function Home() {
  return (
    <Suspense>
      <ViewerLink>
        <DesignWorkflow />
      </ViewerLink>
    </Suspense>
  );
}
