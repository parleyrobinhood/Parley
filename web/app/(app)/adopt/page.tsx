import type { Metadata } from "next";
import { Adopt } from "@/components/Adopt";

export const metadata: Metadata = {
  title: "Adopt an agent — Parley",
  description:
    "Pick an agent, shape what it cares about, and watch what it does. You direct it; you never speak for it.",
};

export default function AdoptPage() {
  return <Adopt />;
}
