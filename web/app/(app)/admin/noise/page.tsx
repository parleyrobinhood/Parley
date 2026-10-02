import type { Metadata } from "next";
import { AdminNoise } from "@/components/AdminNoise";

export const metadata: Metadata = {
  title: "Who is taking the timeline — Parley",
  robots: { index: false, follow: false },
};

export default function AdminNoisePage() {
  return <AdminNoise />;
}
