import { createHash, createHmac } from "node:crypto";
import type { MediaDownloadGrant, MediaObjectStore, MediaUploadGrant } from "./types.ts";

export interface S3MediaStorageConfig {
  readonly endpoint: string;
  readonly bucket: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function amzDate(value: Date): { date: string; timestamp: string } {
  const iso = value.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { date: iso.slice(0, 8), timestamp: iso };
}

function encode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => "%" + char.charCodeAt(0).toString(16).toUpperCase(),
  );
}

function objectPath(bucket: string, objectKey: string): string {
  return "/" + encode(bucket) + "/" + objectKey.split("/").map(encode).join("/");
}

export function mediaStorageConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): S3MediaStorageConfig | null {
  const endpoint = env.MEDIA_S3_ENDPOINT?.trim();
  const bucket = env.MEDIA_S3_BUCKET?.trim();
  const region = env.MEDIA_S3_REGION?.trim();
  const accessKeyId = env.MEDIA_S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.MEDIA_S3_SECRET_ACCESS_KEY?.trim();
  const values = [endpoint, bucket, region, accessKeyId, secretAccessKey];
  if (values.every((value) => !value)) return null;
  if (values.some((value) => !value)) {
    throw new Error("MEDIA_S3_* configuration must be supplied completely");
  }
  const parsed = new URL(endpoint as string);
  if (
    parsed.protocol !== "https:" &&
    parsed.hostname !== "127.0.0.1" &&
    parsed.hostname !== "localhost"
  ) {
    throw new Error("MEDIA_S3_ENDPOINT must use HTTPS outside loopback");
  }
  return {
    endpoint: parsed.origin + parsed.pathname.replace(/\/$/, ""),
    bucket: bucket as string,
    region: region as string,
    accessKeyId: accessKeyId as string,
    secretAccessKey: secretAccessKey as string,
  };
}

export class S3MediaObjectStore implements MediaObjectStore {
  readonly #config: S3MediaStorageConfig;

  constructor(config: S3MediaStorageConfig) {
    this.#config = config;
  }

  #presign(
    method: "PUT" | "GET" | "HEAD" | "DELETE",
    objectKey: string,
    expiresAt: Date,
    extraHeaders: Readonly<Record<string, string>> = {},
  ): { url: string; headers: Readonly<Record<string, string>> } {
    const now = new Date();
    const seconds = Math.max(
      1,
      Math.min(3600, Math.floor((expiresAt.getTime() - now.getTime()) / 1000)),
    );
    const { date, timestamp } = amzDate(now);
    const endpoint = new URL(this.#config.endpoint);
    const path = objectPath(this.#config.bucket, objectKey);
    const credentialScope = date + "/" + this.#config.region + "/s3/aws4_request";
    const canonicalHeadersMap: Record<string, string> = { host: endpoint.host };
    for (const [name, value] of Object.entries(extraHeaders)) {
      canonicalHeadersMap[name.toLowerCase()] = value.trim().replace(/\s+/g, " ");
    }
    const signedHeaderNames = Object.keys(canonicalHeadersMap).sort();
    const signedHeaders = signedHeaderNames.join(";");
    const canonicalHeaders = signedHeaderNames
      .map((name) => name + ":" + canonicalHeadersMap[name] + "\n")
      .join("");

    const query = new URLSearchParams({
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": this.#config.accessKeyId + "/" + credentialScope,
      "X-Amz-Date": timestamp,
      "X-Amz-Expires": String(seconds),
      "X-Amz-SignedHeaders": signedHeaders,
    });
    const canonicalQuery = [...query.entries()]
      .sort(([aKey, aValue], [bKey, bValue]) =>
        aKey === bKey ? aValue.localeCompare(bValue) : aKey.localeCompare(bKey),
      )
      .map(([key, value]) => encode(key) + "=" + encode(value))
      .join("&");
    const canonicalRequest = [
      method,
      path,
      canonicalQuery,
      canonicalHeaders,
      signedHeaders,
      "UNSIGNED-PAYLOAD",
    ].join("\n");
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      timestamp,
      credentialScope,
      sha256(canonicalRequest),
    ].join("\n");
    const kDate = hmac("AWS4" + this.#config.secretAccessKey, date);
    const kRegion = hmac(kDate, this.#config.region);
    const kService = hmac(kRegion, "s3");
    const kSigning = hmac(kService, "aws4_request");
    query.set("X-Amz-Signature", hmac(kSigning, stringToSign).toString("hex"));

    return {
      url: this.#config.endpoint + path + "?" + query.toString(),
      headers: Object.fromEntries(
        Object.entries(extraHeaders).map(([name, value]) => [name.toLowerCase(), value]),
      ),
    };
  }

  async createUploadGrant(input: {
    readonly objectKey: string;
    readonly sha256: string;
    readonly expiresAt: Date;
  }): Promise<MediaUploadGrant> {
    const requiredHeaders = {
      "content-type": "application/octet-stream",
      "if-none-match": "*",
      "x-amz-meta-sha256": input.sha256,
    };
    const signed = this.#presign("PUT", input.objectKey, input.expiresAt, requiredHeaders);
    return { url: signed.url, expiresAt: input.expiresAt, requiredHeaders: signed.headers };
  }

  async verifyObject(input: {
    readonly objectKey: string;
    readonly expectedBytes: bigint;
    readonly sha256: string;
  }): Promise<boolean> {
    const expiresAt = new Date(Date.now() + 60_000);
    const signed = this.#presign("HEAD", input.objectKey, expiresAt);
    const response = await fetch(signed.url, { method: "HEAD", redirect: "error" });
    if (response.status === 404) return false;
    if (!response.ok) throw new Error("MEDIA_STORAGE_HEAD_FAILED_" + response.status);
    const length = response.headers.get("content-length");
    const digest = response.headers.get("x-amz-meta-sha256");
    return length === input.expectedBytes.toString() && digest === input.sha256;
  }

  async createDownloadGrant(input: {
    readonly objectKey: string;
    readonly expiresAt: Date;
  }): Promise<MediaDownloadGrant> {
    return {
      url: this.#presign("GET", input.objectKey, input.expiresAt).url,
      expiresAt: input.expiresAt,
    };
  }

  async deleteObject(objectKey: string): Promise<void> {
    const signed = this.#presign("DELETE", objectKey, new Date(Date.now() + 60_000));
    const response = await fetch(signed.url, { method: "DELETE", redirect: "error" });
    if (response.status === 404) return;
    if (!response.ok) throw new Error("MEDIA_STORAGE_DELETE_FAILED_" + response.status);
  }
}
