import assert from "node:assert/strict";
import test from "node:test";
import {
  BrevoEmailDelivery,
  renderEmailMessage,
  renderSecurityEmail,
} from "../src/auth/brevo-email-delivery.ts";
import { PermanentWorkerError, RetryableWorkerError } from "../src/runtime/errors.ts";

const message = {
  deliveryId: "delivery-123",
  destination: "person@example.test",
  template: "verification_code",
  parameters: {
    code: "12345678",
    purpose: "registration",
    expiresAt: "2026-10-01T12:10:00.000Z",
    expiresInMinutes: 10,
  },
} as const;

function providerConfig(timeoutMs = 10_000) {
  return {
    apiKey: "placeholder",
    senderEmail: "auth@example.test",
    senderName: "Shawtie pls",
    timeoutMs,
  };
}

test("verification template renders code and expiry in HTML and text", () => {
  const rendered = renderSecurityEmail(message);
  assert.equal(rendered.subject, "Verify your Shawtie pls email");
  assert.match(rendered.textContent, /12345678/);
  assert.match(rendered.textContent, /expires in 10 minutes/);
  assert.match(rendered.htmlContent, /12345678/);
  assert.match(rendered.htmlContent, /expires in 10 minutes/);
  assert.doesNotMatch(rendered.htmlContent, /person@example\.test/);
});

test("serious security templates stay minimal and render reviewed deadline context", () => {
  const rendered = renderEmailMessage({
    deliveryId: "security-1",
    destination: "person@example.test",
    template: "breakup_started",
    parameters: { deadline: "2026-10-10T12:00:00.000Z" },
  });
  assert.equal(rendered.subject, "A Shawtie pls breakup process started");
  assert.match(rendered.textContent, /2026-10-10T12:00:00.000Z/);
  assert.doesNotMatch(rendered.textContent, /message|photo|nickname|partner name/i);
  assert.doesNotMatch(rendered.htmlContent, /person@example\.test/);

  assert.equal(
    renderEmailMessage({
      deliveryId: "security-2",
      destination: "old@example.test",
      template: "email_changed_old_address",
      parameters: {},
    }).subject,
    "Your Shawtie pls email was changed",
  );
});

test("verification template rejects unsupported or malformed input", () => {
  assert.throws(
    () => renderSecurityEmail({ ...message, template: "breakup_started" }),
    (error: unknown) =>
      error instanceof PermanentWorkerError && error.code === "EMAIL_TEMPLATE_UNSUPPORTED",
  );
  assert.throws(
    () =>
      renderSecurityEmail({
        ...message,
        parameters: { ...message.parameters, purpose: "marketing" },
      }),
    (error: unknown) =>
      error instanceof PermanentWorkerError && error.code === "EMAIL_TEMPLATE_PARAMETER_INVALID",
  );
});

test("provider request uses Brevo transactional endpoint and idempotency", async () => {
  let seenUrl = "";
  let seenInit: RequestInit | undefined;
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
    seenUrl = String(input);
    seenInit = init;
    return new Response(JSON.stringify({ messageId: "provider-message-id" }), { status: 201 });
  };
  const delivery = new BrevoEmailDelivery(providerConfig(), fakeFetch);
  await delivery.sendSecurityEmail(message, new AbortController().signal);

  assert.equal(seenUrl, "https://api.brevo.com/v3/smtp/email");
  const body = JSON.parse(String(seenInit?.body)) as {
    to: Array<{ email: string }>;
    subject: string;
    htmlContent: string;
    textContent?: string;
    headers: Record<string, string>;
  };
  assert.deepEqual(body.to, [{ email: "person@example.test" }]);
  assert.equal(body.subject, "Verify your Shawtie pls email");
  assert.match(body.htmlContent, /12345678/);
  assert.equal(body.textContent, undefined);
  assert.equal(body.headers.idempotencyKey, "delivery-123");
  assert.doesNotMatch(String(seenInit?.body), /placeholder/);
});

test("duplicate idempotency response is treated as already delivered", async () => {
  const delivery = new BrevoEmailDelivery(
    providerConfig(),
    async () =>
      new Response(JSON.stringify({ code: "duplicate_parameter" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
  );
  await delivery.sendSecurityEmail(message, new AbortController().signal);
});

test("retryable and permanent provider failures are classified", async () => {
  const throttled = new BrevoEmailDelivery(
    providerConfig(),
    async () => new Response("rate limited", { status: 429 }),
  );
  await assert.rejects(
    throttled.sendSecurityEmail(message, new AbortController().signal),
    (error: unknown) =>
      error instanceof RetryableWorkerError && error.code === "BREVO_TEMPORARY_FAILURE",
  );

  const rejected = new BrevoEmailDelivery(
    providerConfig(),
    async () => new Response("bad sender", { status: 400 }),
  );
  await assert.rejects(
    rejected.sendSecurityEmail(message, new AbortController().signal),
    (error: unknown) =>
      error instanceof PermanentWorkerError && error.code === "BREVO_DELIVERY_REJECTED",
  );
});

test("provider timeout becomes a retryable worker failure", async () => {
  const delivery = new BrevoEmailDelivery(providerConfig(1), (_input, init) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return reject(new Error("missing signal"));
      const guard = setTimeout(() => reject(new Error("fake fetch did not observe timeout")), 250);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(guard);
          reject(signal.reason);
        },
        { once: true },
      );
    });
  });
  await assert.rejects(
    delivery.sendSecurityEmail(message, new AbortController().signal),
    (error: unknown) => error instanceof RetryableWorkerError && error.code === "BREVO_TIMEOUT",
  );
});
