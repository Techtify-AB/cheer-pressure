import { notFound } from "next/navigation";
import { ActivityHost } from "@/components/activities/ActivityHost";
import { ACTIVITY_IDS, activityById, type ActivityId } from "@/lib/activities";

// One static page per activity: the export writes /activities/<id>/index.html for each.
export const dynamicParams = false;

export function generateStaticParams() {
  return ACTIVITY_IDS.map((id) => ({ id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `${activityById(id)?.title ?? "Things to do"} · Cheer Pressure` };
}

export default async function ActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!activityById(id)) notFound();
  return <ActivityHost key={id} id={id as ActivityId} />;
}
