import type { Metadata } from "next";
import { requireOnboardedUser } from "@/lib/auth/guards";
import { listContacts } from "@/lib/social/contact-service";
import { ContactsView } from "./contacts-view";

export const metadata: Metadata = {
  title: "Contacts",
};

export default async function ContactsPage() {
  const auth = await requireOnboardedUser("/contacts");
  const contacts = await listContacts(auth.user.id);
  return <ContactsView initialContacts={contacts} />;
}
