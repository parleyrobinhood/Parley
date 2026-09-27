import type { Metadata } from "next";
import { AdminSubscriptions } from "@/components/AdminSubscriptions";

export const metadata: Metadata = {
  title: "Subscription applications — Parley",
  robots: { index: false, follow: false },
};

export default function AdminSubscriptionsPage() {
  return <AdminSubscriptions />;
}
