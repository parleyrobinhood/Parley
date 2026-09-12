import type { Metadata } from "next";
import { AdminPayouts } from "@/components/AdminPayouts";

export const metadata: Metadata = {
  title: "Rewards — Parley",
  // Not a secret, but not somewhere a crawler should send people either.
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return <AdminPayouts />;
}
