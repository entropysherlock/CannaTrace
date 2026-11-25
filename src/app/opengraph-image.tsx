import { ImageResponse } from "next/og";

export const alt = "Leaf2Sale: seed-to-sale software for licensed cannabis businesses";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 80, background: "linear-gradient(135deg, #f4faf6, #cfe8d6)", color: "#0c3020" }}>
        <div style={{ fontSize: 40, fontWeight: 700, color: "#1d6a35" }}>Leaf2Sale</div>
        <div style={{ marginTop: 24, fontSize: 84, fontWeight: 800, lineHeight: 1.05 }}>From seed to sale. Fully tracked.</div>
        <div style={{ marginTop: 32, fontSize: 36, color: "#2f4f3d" }}>Cannabis inventory, compliance, labels, and retail in one platform. Built in New Mexico.</div>
      </div>
    ),
    size,
  );
}
