import type { Metadata } from "next";
import RubyAdmin from "./ruby-admin";

export const metadata: Metadata = {
  title: "Badge production · Ruby setup",
  description: "Connect the BIDC computer to the badge production workflow.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function AdminPage() {
  return <RubyAdmin />;
}
