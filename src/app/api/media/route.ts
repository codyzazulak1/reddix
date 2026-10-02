import { randomUUID } from "node:crypto";
import sharp from "sharp";
import {
  apiError,
  apiMember,
  json,
  readBoundedBody,
  requireSameOrigin,
} from "@/server/http";
import { DomainError, requireEligible } from "@/server/domain";
import { enforceRateLimit } from "@/server/actions";
import { sql } from "@/server/db";
import { deletePrivateImage, writePrivateImage } from "@/server/storage";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const member = await apiMember(request);
    requireEligible(member);
    await enforceRateLimit(member.id, "upload");
    const raw = await readBoundedBody(request, 4_400_000);
    let form: FormData;
    try {
      form = await new Response(raw as BodyInit, {
        headers: { "Content-Type": request.headers.get("content-type") ?? "" },
      }).formData();
    } catch {
      throw new DomainError(
        "VALIDATION_ERROR",
        "Choose a valid image upload.",
        422,
      );
    }
    const file = form.get("file"),
      alt = String(form.get("alt") ?? "")
        .trim()
        .slice(0, 500);
    if (!(file instanceof File) || file.size > 4 * 1024 * 1024 || file.size < 1)
      throw new DomainError(
        "VALIDATION_ERROR",
        "Choose an image smaller than 4 MB.",
        422,
      );
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
      throw new DomainError(
        "VALIDATION_ERROR",
        "Choose a JPEG, PNG, or WebP image.",
        422,
      );
    const original = Buffer.from(await file.arrayBuffer());
    const jpeg =
      original.length >= 3 &&
      original[0] === 0xff &&
      original[1] === 0xd8 &&
      original[2] === 0xff;
    const png =
      original.length >= 8 &&
      original
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const webp =
      original.length >= 12 &&
      original.toString("ascii", 0, 4) === "RIFF" &&
      original.toString("ascii", 8, 12) === "WEBP";
    if (!jpeg && !png && !webp)
      throw new DomainError(
        "VALIDATION_ERROR",
        "The file must contain a valid JPEG, PNG, or WebP image.",
        422,
      );
    let output: Buffer, info: { width: number; height: number };
    try {
      const result = await sharp(original, {
        limitInputPixels: 40000000,
        animated: false,
      })
        .rotate()
        .resize({
          width: 2400,
          height: 2400,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 85 })
        .toBuffer({ resolveWithObject: true });
      output = result.data;
      info = result.info;
    } catch {
      throw new DomainError(
        "VALIDATION_ERROR",
        "This image could not be read. Try a different file.",
        422,
      );
    }
    if (output.length > 4 * 1024 * 1024)
      throw new DomainError(
        "VALIDATION_ERROR",
        "This image is too large after processing. Choose a smaller image.",
        422,
      );
    const id = randomUUID(),
      storageKey = await writePrivateImage(id, output, "image/webp");
    try {
      await sql`INSERT INTO media_assets(id,owner_id,storage_key,mime_type,byte_size,width,height,alt_text)
        VALUES(${id},${member.id},${storageKey},'image/webp',${output.length},${info.width},${info.height},${alt})`;
    } catch (error) {
      try {
        await deletePrivateImage(storageKey);
      } catch {
        console.error("Could not clean up an orphaned private upload", {
          assetId: id,
        });
      }
      throw error;
    }
    return json({
      id,
      url: `/api/media/${id}`,
      alt,
      width: info.width,
      height: info.height,
    });
  } catch (error) {
    return apiError(error);
  }
}
