import type { MetadataRoute } from "next";

/** Lets a phone add CannaTrace to its home screen. It opens straight to the camera screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CannaTrace",
    short_name: "CannaTrace",
    description: "Seed-to-sale for New Mexico cannabis businesses",
    start_url: "/capture",
    scope: "/",
    display: "standalone",
    background_color: "#eef3ef",
    theme_color: "#1d6a35",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
