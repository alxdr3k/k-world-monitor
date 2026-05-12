/**
 * Cloudflare R2 client wrapper (INFRA-1A.3).
 * Enforces permitted-artifact prefix policy on every write (ADR-0012 INV-0012-4).
 *
 * Credentials from env (Doppler intelligence-pipeline/dev):
 *   S3_ACCOUNT_ID   — Cloudflare account ID
 *   S3_ACCESS_KEY   — R2 access key ID
 *   S3_SECRET_KEY   — R2 secret access key
 *   S3_BUCKET       — R2 bucket name
 */

import { checkPermittedPrefix, sha256HexBuf } from "./policy";

export interface R2PutResult {
  key: string;
  sha256: string;
  byteSize: number;
}

export interface R2GetResult {
  key: string;
  data: ArrayBuffer;
  sha256: string;
  byteSize: number;
}

function buildEndpoint(): string {
  const accountId = process.env["S3_ACCOUNT_ID"];
  if (!accountId) throw new Error("s3_account_id env var not set");
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

function buildClient(): InstanceType<typeof Bun.S3Client> {
  const accessKeyId = process.env["S3_ACCESS_KEY"];
  const secretAccessKey = process.env["S3_SECRET_KEY"];
  const bucket = process.env["S3_BUCKET"];

  if (!accessKeyId) throw new Error("s3_access_key env var not set");
  if (!secretAccessKey) throw new Error("s3_secret_key env var not set");
  if (!bucket) throw new Error("s3_bucket env var not set");

  return new Bun.S3Client({
    endpoint: buildEndpoint(),
    region: "auto",
    accessKeyId,
    secretAccessKey,
    bucket,
  });
}

let _client: InstanceType<typeof Bun.S3Client> | null = null;

function getClient(): InstanceType<typeof Bun.S3Client> {
  if (!_client) _client = buildClient();
  return _client;
}

/** Reset the singleton — use in tests when swapping credentials. */
export function resetClient(): void {
  _client = null;
}

/**
 * Write data to R2 under key. Enforces permitted prefix policy before upload.
 * Returns key, sha256 hex, and byte size.
 */
export async function r2Put(key: string, data: ArrayBuffer): Promise<R2PutResult> {
  checkPermittedPrefix(key);
  const byteSize = data.byteLength;
  const sha256 = await sha256HexBuf(data);
  await getClient().write(key, data);
  return { key, sha256, byteSize };
}

/**
 * Read data from R2 under key. Returns data, sha256 hex, and byte size.
 */
export async function r2Get(key: string): Promise<R2GetResult> {
  const buf = await getClient().file(key).arrayBuffer();
  const sha256 = await sha256HexBuf(buf);
  return { key, data: buf, sha256, byteSize: buf.byteLength };
}

/**
 * Delete a key from R2.
 */
export async function r2Delete(key: string): Promise<void> {
  await getClient().delete(key);
}

/**
 * Returns true if the bucket credentials are configured in env.
 * Use to guard integration tests.
 */
export function r2CredentialsAvailable(): boolean {
  return Boolean(
    process.env["S3_ACCOUNT_ID"] &&
      process.env["S3_ACCESS_KEY"] &&
      process.env["S3_SECRET_KEY"] &&
      process.env["S3_BUCKET"]
  );
}
