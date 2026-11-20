import type { SafetyGuideView } from "@nexus/shared-types";

/** Static education content. Never instructs users to share credentials or grant device access. */
export const SAFETY_GUIDES: SafetyGuideView[] = [
  {
    id: "social-engineering", title: "Social engineering", summary: "Attackers create urgency or trust to make you act before thinking.",
    bullets: ["Pause before sending money, even if the request sounds urgent.", "Verify the person through a channel you already trust.", "Nexus Pay staff never ask for your password, OTP or UPI PIN."],
  },
  {
    id: "impersonation", title: "Impersonation scams", summary: "Someone may pretend to be a friend, relative or official.",
    bullets: ["Confirm unusual requests with a phone call to a known number.", "Check the recipient name shown in Nexus Pay before confirming.", "Do not rely on a screenshot as proof of payment."],
  },
  {
    id: "fake-support", title: "Fake customer support", summary: "Fraudsters advertise fake helplines and ask for remote access.",
    bullets: ["Use only the contact details inside the app or on official material.", "Never install remote-access apps at someone else's request.", "Never share an OTP, PIN or password with anyone."],
  },
  {
    id: "remote-access", title: "Remote-access app scams", summary: "Remote access lets a stranger control your device and approve payments.",
    bullets: ["Do not install screen-sharing or remote-control apps on request.", "Close any unexpected remote session immediately.", "Contact us from a different device if you suspect compromise."],
  },
  {
    id: "fake-payment-screenshots", title: "Fake payment screenshots", summary: "A screenshot is not proof that money reached your account.",
    bullets: ["Check the transaction inside Nexus Pay instead.", "Treat 'payment sent' claims as unconfirmed until verified.", "Do not release goods based only on an image."],
  },
  {
    id: "qr-manipulation", title: "QR-code manipulation", summary: "A substituted QR code can send money to the wrong person.",
    bullets: ["Confirm the recipient name shown after scanning.", "Check the code has not been replaced or covered.", "Cancel if the displayed name is unexpected."],
  },
  {
    id: "investment-scams", title: "Investment scams", summary: "Promises of guaranteed or unusually high returns are a warning sign.",
    bullets: ["Be sceptical of guaranteed profits and pressure to act quickly.", "Verify the entity through official channels before paying.", "Nexus Pay does not endorse investment schemes."],
  },
  {
    id: "loan-insurance-impersonation", title: "Loan and insurance impersonation", summary: "Scammers pose as lenders or insurers and ask for advance fees.",
    bullets: ["Nexus Pay never asks for advance fees to release a loan or policy.", "Verify provider identity before sharing documents.", "Policy and loan status shown in the app is provider-confirmed."],
  },
  {
    id: "otp-pin-theft", title: "OTP and PIN theft", summary: "No legitimate representative needs your OTP or UPI PIN.",
    bullets: ["Never read out an OTP or enter a PIN at someone's request.", "Do not store OTPs or PINs in photos or notes.", "Report any disclosure immediately."],
  },
  {
    id: "refund-scams", title: "Refund scams", summary: "Fake refunds are used to trick you into approving a payment.",
    bullets: ["A refund does not require you to send money first.", "Check refund status in the app, not through links in messages.", "If a payment settled, a fraud report does not reverse it automatically."],
  },
];
