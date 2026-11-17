import type { Metadata } from "next";
import { requireOnboardedUser } from "@/lib/auth/guards";
import { listGroups } from "@/lib/social/group-service";
import { GroupsView } from "./groups-view";

export const metadata: Metadata = {
  title: "Split expenses",
};

export default async function GroupsPage() {
  const auth = await requireOnboardedUser("/groups");
  const groups = await listGroups(auth.user.id);
  return <GroupsView initialGroups={groups} />;
}
