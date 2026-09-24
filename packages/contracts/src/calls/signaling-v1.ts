import { z } from "zod";

export const C1_SIGNALING_SUBPROTOCOL = "shawtie.call.v1" as const;
export const C1_SIGNALING_PROTOCOL_VERSION = 1 as const;
export const C1_SIGNALING_MAX_FRAME_BYTES = 64 * 1024;
export const C1_SIGNALING_MAX_SDP_BYTES = 48 * 1024;
export const C1_SIGNALING_MAX_CANDIDATE_BYTES = 2048;
export const C1_SIGNALING_MAX_CANDIDATES = 256;

const generation = z.number().int().safe().positive();
const sdp = z.string().min(1).max(C1_SIGNALING_MAX_SDP_BYTES);
const candidate = z.string().min(1).max(C1_SIGNALING_MAX_CANDIDATE_BYTES);

function frame<T extends string, S extends z.ZodTypeAny>(type: T, payload: S) {
  return z
    .object({
      v: z.literal(C1_SIGNALING_PROTOCOL_VERSION),
      type: z.literal(type),
      generation,
      payload,
    })
    .strict();
}

export const c1SignalDescriptionSchema = frame(
  "signal.description",
  z.object({ descriptionType: z.enum(["offer", "answer"]), sdp }).strict(),
);
export const c1SignalCandidateSchema = frame(
  "signal.ice_candidate",
  z.object({ candidate }).strict(),
);
export const c1SignalEndCandidatesSchema = frame("signal.end_of_candidates", z.object({}).strict());
export const c1SignalRestartSchema = frame("signal.restart", z.object({}).strict());
export const c1SignalReadySchema = frame(
  "control.ready",
  z.object({ polite: z.boolean() }).strict(),
);
export const c1SignalSupersededSchema = frame("control.superseded", z.object({}).strict());

export const c1SignalClientFrameSchema = z.discriminatedUnion("type", [
  c1SignalDescriptionSchema,
  c1SignalCandidateSchema,
  c1SignalEndCandidatesSchema,
  c1SignalRestartSchema,
]);

export const c1SignalServerFrameSchema = z.union([
  c1SignalDescriptionSchema,
  c1SignalCandidateSchema,
  c1SignalEndCandidatesSchema,
  c1SignalRestartSchema,
  c1SignalReadySchema,
  c1SignalSupersededSchema,
]);

export type C1SignalClientFrame = z.infer<typeof c1SignalClientFrameSchema>;
export type C1SignalServerFrame = z.infer<typeof c1SignalServerFrameSchema>;
