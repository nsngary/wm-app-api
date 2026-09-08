import assert from "node:assert/strict";
import { staticMapUrl } from "./static-map";

assert.equal(staticMapUrl("苗栗縣三義鄉西湖村西湖11號", { apiKey: "", signingSecret: "" }), null);

const url = staticMapUrl("苗栗縣三義鄉西湖村西湖11號", {
  apiKey: "test-key",
  signingSecret: "a2V5",
});

assert.match(url!, /^https:\/\/maps\.googleapis\.com\/maps\/api\/staticmap\?/);
assert.match(url!, /markers=/);
assert.match(url!, /key=test-key/);
assert.match(url!, /signature=/);

const previousApiKey = process.env.GOOGLE_MAPS_STATIC_API_KEY;
const previousSigningSecret = process.env.GOOGLE_MAPS_URL_SIGNING_SECRET;
process.env.GOOGLE_MAPS_STATIC_API_KEY = "env-test-key";
process.env.GOOGLE_MAPS_URL_SIGNING_SECRET = "a2V5";
try {
  assert.match(
    staticMapUrl("苗栗縣三義鄉西湖村西湖11號")!,
    /key=env-test-key/,
    "static maps must use the documented URL signing secret environment variable",
  );
} finally {
  if (previousApiKey === undefined) delete process.env.GOOGLE_MAPS_STATIC_API_KEY;
  else process.env.GOOGLE_MAPS_STATIC_API_KEY = previousApiKey;
  if (previousSigningSecret === undefined) delete process.env.GOOGLE_MAPS_URL_SIGNING_SECRET;
  else process.env.GOOGLE_MAPS_URL_SIGNING_SECRET = previousSigningSecret;
}

console.log("static map contracts ok");
