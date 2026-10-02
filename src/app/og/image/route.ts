import { renderSocialImage } from "@/server/social-image";

export const runtime = "nodejs";

export async function GET() {
  return renderSocialImage();
}
