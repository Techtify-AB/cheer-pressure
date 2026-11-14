import type { Metadata } from "next";
import Person from "./Person";

export const metadata: Metadata = { title: "Cheer Pressure" };

export default async function Page({ params }: { params: Promise<{ pair: string }> }) {
  const { pair } = await params;
  return <Person pair={pair.toUpperCase()} />;
}
