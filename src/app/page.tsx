import { redirect } from "next/navigation";
import { getSessionUser, landingPathFor } from "@/lib/auth";

/** Sends each audience to its own side of the portal. */
export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  redirect(landingPathFor(user.role));
}
