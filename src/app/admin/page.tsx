import type { Metadata } from "next";
import RubyAdmin from "./ruby-admin";

export const metadata: Metadata = {
  title: "Badge production · Ruby",
  description: "Upload badge cutting files and check the Ruby laser queue from BIDC.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function AdminPage() {
  return <RubyAdmin />;
}
