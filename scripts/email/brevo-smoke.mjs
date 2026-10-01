import { randomUUID } from "node:crypto";
import { BrevoEmailDelivery, brevoEmailConfigFromEnv } from "../../apps/worker/dist/auth/brevo-email-delivery.js";

if (process.env.BREVO_SMOKE_CONFIRM !== "SEND") {
  throw new Error("Set BREVO_SMOKE_CONFIRM=SEND to allow one real provider email");
}

const recipient = process.env.BREVO_TEST_RECIPIENT?.trim();
if (!recipient) {
  throw new Error("BREVO_TEST_RECIPIENT is required");
}

const config = brevoEmailConfigFromEnv({
  ...process.env,
  EMAIL_PROVIDER: "brevo",
});
if (!config) throw new Error("Brevo configuration is unavailable");

const delivery = new BrevoEmailDelivery(config);
const expiresAt = new Date(Date.now() + 10 * 60_000);

await delivery.sendSecurityEmail(
  {
    deliveryId: randomUUID(),
    destination: recipient,
    template: "verification_code",
    parameters: {
      code: "00000000",
      purpose: "registration",
      expiresAt: expiresAt.toISOString(),
      expiresInMinutes: 10,
    },
  },
  new AbortController().signal,
);

console.log("BREVO_SMOKE_EMAIL_SENT");
