import { PageSkeleton } from "@/components/ui";

/**
 * The default loading state for every route in this group.
 *
 * Route-level `loading.tsx` files override it where a page's shape is distinctive enough that
 * a generic table skeleton would flash the wrong layout.
 */
export default function Loading() {
  return <PageSkeleton />;
}
