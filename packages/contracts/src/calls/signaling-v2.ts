import { z } from "zod";

export const C2_SIGNALING_SUBPROTOCOL = "shawtie.call.v2" as const;
export const C2_SIGNALING_PROTOCOL_VERSION = 2 as const;
export const C2_SIGNALING_MAX_FRAME_BYTES = 64 * 1024;
export const C2_SIGNALING_MAX_SDP_BYTES = 48 * 1024;
export const C2_SIGNALING_MAX_CANDIDATE_BYTES = 2048;
export const C2_SIGNALING_MAX_CANDIDATES = 256;

const generation = z.number().int().safe().positive();
const sdp = z.string().min(1).max(C2_SIGNALING_MAX_SDP_BYTES);
const candidate = z.string().min(1).max(C2_SIGNALING_MAX_CANDIDATE_BYTES);
const sdpMid = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[A-Za-z0-9_.-]+$/);
const sdpMLineIndex = z.union([z.literal(0), z.literal(1)]);

function frame<T extends string, S extends z.ZodTypeAny>(type: T, payload: S) {
  return z
    .object({
      v: z.literal(C2_SIGNALING_PROTOCOL_VERSION),
      type: z.literal(type),
      generation,
      payload,
    })
    .strict();
}

const candidatePayload = z
  .object({
    candidate,
    sdpMid: sdpMid.nullable(),
    sdpMLineIndex: sdpMLineIndex.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.sdpMid === null && value.sdpMLineIndex === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "C2 candidate requires sdpMid or sdpMLineIndex",
      });
    }
  });

export const c2SignalDescriptionSchema = frame(
  "signal.description",
  z.object({ descriptionType: z.enum(["offer", "answer"]), sdp }).strict(),
);
export const c2SignalCandidateSchema = frame("signal.ice_candidate", candidatePayload);
export const c2SignalEndCandidatesSchema = frame("signal.end_of_candidates", z.object({}).strict());
export const c2SignalRestartSchema = frame("signal.restart", z.object({}).strict());
export const c2SignalReadySchema = frame(
  "control.ready",
  z.object({ polite: z.boolean() }).strict(),
);
export const c2SignalSupersededSchema = frame("control.superseded", z.object({}).strict());

export const c2SignalClientFrameSchema = z.discriminatedUnion("type", [
  c2SignalDescriptionSchema,
  c2SignalCandidateSchema,
  c2SignalEndCandidatesSchema,
  c2SignalRestartSchema,
]);

export const c2SignalServerFrameSchema = z.union([
  c2SignalDescriptionSchema,
  c2SignalCandidateSchema,
  c2SignalEndCandidatesSchema,
  c2SignalRestartSchema,
  c2SignalReadySchema,
  c2SignalSupersededSchema,
]);

export type C2SignalClientFrame = z.infer<typeof c2SignalClientFrameSchema>;
export type C2SignalServerFrame = z.infer<typeof c2SignalServerFrameSchema>;
