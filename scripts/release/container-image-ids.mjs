import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";

const images = process.argv.slice(2);
if (images.length === 0) throw new Error("At least one container image is required");

const records = [];
for (const image of images) {
  const id = execFileSync(
    "docker",
    ["image", "inspect", "--format", "{{.Id}}", image],
    { encoding: "utf8" },
  ).trim();
  if (!/^sha256:[0-9a-f]{64}$/.test(id)) {
    throw new Error("Unexpected container image ID for " + image);
  }
  records.push({ image, id });
}

const output = path.resolve(
  process.env.R2_CONTAINER_EVIDENCE_FILE || "r2-container-image-ids.json",
);
await writeFile(
  output,
  JSON.stringify(
    {
      schemaVersion: 1,
      sourceSha: process.env.R2_CANDIDATE_SHA?.trim() || null,
      images: records,
    },
    null,
    2,
  ) + "\n",
);
console.log("R2_CONTAINER_IMAGE_IDS_PASS images=" + records.length + " file=" + output);
