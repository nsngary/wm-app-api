import { createServer } from "node:http";
import { apiHost, apiPort } from "./db";
import { handleApi } from "./api";

const host = apiHost();
const port = apiPort();

createServer(handleApi).listen(port, host, () => {
  console.log(`TeamUp API listening on http://${host}:${port}`);
});
