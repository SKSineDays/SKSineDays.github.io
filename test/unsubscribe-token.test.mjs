import test from "node:test";
import assert from "node:assert/strict";
import {
  createUnsubscribeToken,
  verifyUnsubscribeToken,
  buildUnsubscribePageUrl,
  buildUnsubscribeApiUrl
} from "../api/_lib/unsubscribe-token.js";

const SECRET = "unsubscribe-secret-test-key";
const OTHER = "other-unsubscribe-secret";
const SUB_ID = "11111111-1111-4111-8111-111111111111";

test("signed tokens contain a versioned subscriber UUID and no email", () => {
  const token = createUnsubscribeToken(SUB_ID, SECRET);
  assert.equal(typeof token, "string");
  assert.equal(token.includes("@"), false);
  assert.equal(token.includes(SUB_ID), false);
  const verified = verifyUnsubscribeToken(token, SECRET);
  assert.equal(verified.ok, true);
  assert.equal(verified.subscriberId, SUB_ID);
  assert.equal(verified.version, 1);
});

test("altered unsubscribe tokens are rejected", () => {
  const token = createUnsubscribeToken(SUB_ID, SECRET);
  const [payload, signature] = token.split(".");
  const flipped = signature.endsWith("a") ? `${signature.slice(0, -1)}b` : `${signature.slice(0, -1)}a`;
  assert.equal(verifyUnsubscribeToken(`${payload}.${flipped}`, SECRET).ok, false);
  assert.equal(verifyUnsubscribeToken(`${payload}x.${signature}`, SECRET).ok, false);
  assert.equal(verifyUnsubscribeToken(token, OTHER).ok, false);
  assert.equal(verifyUnsubscribeToken("not-a-token", SECRET).ok, false);
  assert.equal(verifyUnsubscribeToken("", SECRET).ok, false);
});

test("unsupported token versions are rejected", () => {
  const token = createUnsubscribeToken(SUB_ID, SECRET);
  const [, signature] = token.split(".");
  const v2 = Buffer.from(`2.${SUB_ID}`, "utf8").toString("base64url");
  assert.equal(verifyUnsubscribeToken(`${v2}.${signature}`, SECRET).ok, false);
  assert.equal(createUnsubscribeToken("not-a-uuid", SECRET), null);
});

test("unsubscribe URLs never include an email address", () => {
  const env = {
    PUBLIC_SITE_URL: "https://sineday.app",
    UNSUBSCRIBE_SECRET: SECRET
  };
  const page = buildUnsubscribePageUrl(SUB_ID, env);
  const api = buildUnsubscribeApiUrl(SUB_ID, env);
  assert.match(page, /^https:\/\/sineday\.app\/unsubscribe\.html\?token=/);
  assert.match(api, /^https:\/\/sineday\.app\/api\/unsubscribe\?token=/);
  assert.equal(page.includes("@"), false);
  assert.equal(api.includes("@"), false);
});
