import { CardSkeleton, PageHeaderSkeleton } from "@/components/ui";

/** Detail pages are stacked cards in two columns, not a table. */
export default function Loading() {
  return (
    <div className="space-y-5">
      <PageHeaderSkeleton />
      <div className="grid gap-4 lg:grid-cols-2">
        <CardSkeleton lines={5} />
        <CardSkeleton lines={3} />
        <CardSkeleton lines={4} />
        <CardSkeleton lines={6} />
      </div>
    </div>
  );
}
