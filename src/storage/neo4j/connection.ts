import neo4j, { type Driver, type Session } from "neo4j-driver";

function parsePositiveInt(val: string | undefined, fallback: number): number {
  // Require pure digit string to reject "5e3" → 5 (parseInt stops at 'e') and
  // other malformed values that parseInt silently accepts as a numeric prefix.
  if (!val || !/^\d+$/.test(val)) return fallback;
  const n = parseInt(val, 10);
  return n > 0 ? n : fallback;
}

let _driver: Driver | null = null;

export function getDriver(): Driver {
  if (!_driver) {
    const uri = process.env["NEO4J_URI"] ?? "bolt://localhost:7687";
    const user = process.env["NEO4J_USER"] ?? "neo4j";
    const password = process.env["NEO4J_PASSWORD"];
    if (!password) {
      throw new Error("NEO4J_PASSWORD env var is required");
    }
    _driver = neo4j.driver(uri, neo4j.auth.basic(user, password), {
      maxConnectionPoolSize: parsePositiveInt(process.env["NEO4J_MAX_POOL_SIZE"], 10),
      connectionAcquisitionTimeout: parsePositiveInt(process.env["NEO4J_ACQ_TIMEOUT_MS"], 5000),
    });
  }
  return _driver;
}

export async function closeDriver(): Promise<void> {
  if (_driver) {
    await _driver.close();
    _driver = null;
  }
}

export async function withSession<T>(
  fn: (session: Session) => Promise<T>
): Promise<T> {
  const session = getDriver().session({ database: process.env["NEO4J_DATABASE"] ?? "neo4j" });
  try {
    return await fn(session);
  } finally {
    await session.close();
  }
}

export async function verifyConnectivity(): Promise<void> {
  await getDriver().verifyConnectivity();
}
