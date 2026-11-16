import { DemoCustomerProfile } from "./raft/types";

export const DEMO_PROFILES: DemoCustomerProfile[] = [
  {
    id: "alice",
    name: "Alice Smith",
    type: "Consumer Checking",
    currency: "USD",
    routingOrVpa: "Routing: 121000358 (FedNow)",
    avatarColor: "from-emerald-500 to-teal-600",
    accountId: "acc_alice_fednow",
  },
  {
    id: "bob",
    name: "Bob Jones Corp",
    type: "Merchant Operating",
    currency: "USD",
    routingOrVpa: "Routing: 021000021 (FedNow POS)",
    avatarColor: "from-blue-500 to-indigo-600",
    accountId: "acc_bob_fednow",
  },
  {
    id: "charlie",
    name: "Charlie Dupont",
    type: "European Supplier",
    currency: "EUR",
    routingOrVpa: "IBAN: FR76...0189 (SEPA Inst)",
    avatarColor: "from-purple-500 to-pink-600",
    accountId: "acc_charlie_sepa",
  },
  {
    id: "deepak",
    name: "Deepak Patel",
    type: "UPI Tech Vendor",
    currency: "INR",
    routingOrVpa: "VPA: deepak@okicici (UPI Instant)",
    avatarColor: "from-amber-500 to-orange-600",
    accountId: "acc_deepak_upi",
  },
];

