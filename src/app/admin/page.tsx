import type { Metadata } from "next";
import localFont from "next/font/local";
import RubyAdmin from "./ruby-admin";

const polySans = localFont({
  src: [
    { path: "./fonts/PolySans-Neutral.woff2", weight: "400" },
    { path: "./fonts/PolySans-Median.woff2", weight: "500" },
  ],
  variable: "--font-polysans",
  display: "swap",
});
const pixelHackers = localFont({
  src: "./fonts/PixelHackers.woff2",
  weight: "400",
  variable: "--font-pixelhackers",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Badge production · Purdue Hackers",
  description: "Upload badge cutting files and check the Ruby laser queue from BIDC.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function AdminPage() {
  return (
    <div className={`ruby-admin-page ${polySans.variable} ${pixelHackers.variable}`}>
      <RubyAdmin />
    </div>
  );
}
