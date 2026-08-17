import { Card, PageHeaderSkeleton, Skeleton } from "@/components/ui";

/** Review is a split screen: resume on the left, candidate detail on the right. */
export default function Loading() {
  return (
    <div className="space-y-5">
      <PageHeaderSkeleton />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Skeleton className="h-[70vh] w-full rounded-xl" />
        <div className="space-y-4">
          <Card className="space-y-3 p-5">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-3 w-56" />
            <Skeleton className="h-3 w-32" />
          </Card>
          <Card className="space-y-3 p-5">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-4 w-48" />
              </div>
            ))}
          </Card>
          <div className="flex gap-2">
            <Skeleton className="h-9 flex-1" />
            <Skeleton className="h-9 flex-1" />
            <Skeleton className="h-9 w-20" />
          </div>
        </div>
      </div>
    </div>
  );
}
