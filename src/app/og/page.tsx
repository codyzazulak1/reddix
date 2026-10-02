import { SOCIAL_CANVAS_SIZE } from "@/lib/social-share";

export default function SocialPreviewPage() {
  // Preview the actual PNG so a screenshot and a social card are identical.
  return (
    <img
      src="/og/image"
      {...SOCIAL_CANVAS_SIZE}
      alt="Reddix. Your people. Your corner of tech."
    />
  );
}
