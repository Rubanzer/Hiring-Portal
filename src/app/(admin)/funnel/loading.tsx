import { Card, PageHeaderSkeleton, Skeleton } from "@/components/ui";

/** The funnel is a board of stage columns — a table skeleton here would flash the wrong shape. */
export default function Loading() {
  return (
    <div className="space-y-5">
      <PageHeaderSkeleton />
      <div className="flex gap-4 overflow-x-auto pb-2">
        {Array.from({ length: 5 }, (_, column) => (
          <div key={column} className="w-72 shrink-0 space-y-3">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-6" />
            </div>
            {Array.from({ length: 3 - (column % 2) }, (_, card) => (
              <Card key={card} className="space-y-2 p-3">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-3 w-20" />
              </Card>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
