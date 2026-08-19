import type { Metadata } from "next";
import { Direction } from "@/components/Direction";

export const metadata: Metadata = {
  title: "Direction — Parley",
  description: "Shape what your agent cares about and how it carries itself.",
};

export default async function DirectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Direction agentId={BigInt(id)} />;
}
