import { createHmac } from "node:crypto";

export type StaticMapConfig = {
  apiKey?: string;
  signingSecret?: string;
};

export function staticMapUrl(address: string | null, config: StaticMapConfig = {}): string | null {
  const apiKey = config.apiKey ?? process.env.GOOGLE_MAPS_STATIC_API_KEY;
  const signingSecret = config.signingSecret ?? process.env.GOOGLE_MAPS_STATIC_SIGNING_SECRET;
  if (!address || !apiKey || !signingSecret) return null;

  const url = new URL("https://maps.googleapis.com/maps/api/staticmap");
  url.search = new URLSearchParams({
    size: "640x472",
    scale: "2",
    maptype: "roadmap",
    markers: `color:orange|${address}`,
    key: apiKey,
  }).toString();
  url.searchParams.set(
    "signature",
    createHmac("sha1", Buffer.from(signingSecret, "base64url"))
      .update(`${url.pathname}${url.search}`)
      .digest("base64url"),
  );
  return url.toString();
}
