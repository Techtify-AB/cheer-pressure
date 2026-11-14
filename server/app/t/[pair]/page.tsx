import type { Metadata } from "next";
import Trusted from "./Trusted";

export const metadata: Metadata = { title: "Cheer Pressure: send a few words" };

export default async function Page({ params }: { params: Promise<{ pair: string }> }) {
  const { pair } = await params;
  return <Trusted pair={pair.toUpperCase()} />;
}
