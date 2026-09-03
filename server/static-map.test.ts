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

console.log("static map contracts ok");
