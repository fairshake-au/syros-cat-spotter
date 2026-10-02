import {
  createHmac,
  generateKeyPairSync,
  randomBytes,
  sign,
  type KeyObject,
} from "node:crypto";

// Test-only: stands in for the sign-in Worker. Each test file makes its own
// Ed25519 key pair in memory; no real key appears anywhere in the repo.

export interface TestKey {
  privateKey: KeyObject;
  /** Raw public key, base64url: the TEAM_HANDOFF_PUBLIC_KEYS format. */
  publicRaw: string;
}

export function makeKey(): TestKey {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" });
  return { privateKey, publicRaw: jwk.x! };
}

const b64 = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

export function claimsFor(
  personId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: "https://admin.catspotters.com",
    aud: "https://team.catspotters.com",
    sub: personId,
    eml: "someone@example.com",
    sv: 1,
    iat: now,
    exp: now + 60,
    jti: randomBytes(16).toString("base64url"),
    ...overrides,
  };
}

/** A compact JWS signed with Ed25519, as the Worker makes it. */
export function mint(
  key: TestKey,
  claims: Record<string, unknown>,
  header: Record<string, unknown> = { alg: "EdDSA", typ: "JWT" },
): string {
  const signingInput = `${b64(header)}.${b64(claims)}`;
  const signature = sign(null, Buffer.from(signingInput), key.privateKey);
  return `${signingInput}.${signature.toString("base64url")}`;
}

/** The algorithm-confusion attack: HS256 keyed with the public key's bytes. */
export function mintHs256WithPublicKey(
  key: TestKey,
  claims: Record<string, unknown>,
): string {
  const signingInput = `${b64({ alg: "HS256", typ: "JWT" })}.${b64(claims)}`;
  const mac = createHmac("sha256", Buffer.from(key.publicRaw, "base64url"))
    .update(signingInput)
    .digest("base64url");
  return `${signingInput}.${mac}`;
}

/** alg: none, with an empty signature. */
export function mintNone(claims: Record<string, unknown>): string {
  return `${b64({ alg: "none", typ: "JWT" })}.${b64(claims)}.`;
}
