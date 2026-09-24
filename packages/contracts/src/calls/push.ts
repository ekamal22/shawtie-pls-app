import { z } from "zod";

export const C1_PUSH_PAYLOAD_VERSION = 1 as const;
export const c1PushPayloadSchema = z
  .object({
    v: z.literal(C1_PUSH_PAYLOAD_VERSION),
    type: z.literal("call_state_changed"),
  })
  .strict();

export type C1PushPayload = z.infer<typeof c1PushPayloadSchema>;
