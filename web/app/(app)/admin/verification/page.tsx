import type { Metadata } from "next";
import { AdminVerification } from "@/components/AdminVerification";

export const metadata: Metadata = {
  title: "Badge applications — Parley",
  robots: { index: false, follow: false },
};

export default function AdminVerificationPage() {
  return <AdminVerification />;
}
