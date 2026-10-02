"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { BadgeCheck, X, ArrowUpRight } from "lucide-react";
export { CommunityIcon } from "./community-icon";
import { cn } from "@/lib/utils";
import { highResolutionAvatar } from "@/lib/avatar";
import type { PublicMember } from "@/lib/types";
import "./bot-avatar.css";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="wordmark" aria-label="Reddix">
      <span className="logo-mark" aria-hidden="true" />
      {!compact && <span>reddix</span>}
    </span>
  );
}
export function Avatar({
  member,
  size = "normal",
}: {
  member: Pick<PublicMember, "name" | "avatarUrl"> & { isBot?: boolean };
  size?: "small" | "normal" | "large";
}) {
  const initials = member.name
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("");
  const avatarUrl =
    highResolutionAvatar(member.avatarUrl) ||
    (member.isBot ? "/brand/reddix-logo.png" : undefined);
  return (
    <span
      className={cn("avatar", `avatar-${size}`, member.isBot && "avatar-bot")}
      data-color={
        !member.isBot
          ? ["blue", "teal", "rose", "violet", "amber"][
              Array.from(member.name).reduce(
                (sum, char) => sum + char.charCodeAt(0),
                0,
              ) % 5
            ]
          : undefined
      }
      aria-label={member.name}
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt="" referrerPolicy="no-referrer" />
      ) : (
        initials
      )}
    </span>
  );
}
export function Badge({
  type,
  solid = false,
}: {
  type: string;
  solid?: boolean;
}) {
  if (type !== "blue" && type !== "business") return null;
  if (solid)
    return (
      <svg
        width={15}
        height={15}
        viewBox="0 0 24 24"
        className={cn("verification-badge", "verification-badge-solid", type)}
        role="img"
        aria-label={
          type === "business" ? "Business verified on X" : "Blue verified on X"
        }
      >
        <path
          fill="currentColor"
          d="M12 1.5 14.5 3l2.9-.1 1.4 2.5 2.5 1.4-.1 2.9 1.5 2.3-1.5 2.5.1 2.9-2.5 1.4-1.4 2.5-2.9-.1-2.5 1.5-2.3-1.5-2.9.1-1.4-2.5-2.5-1.4.1-2.9L1.5 12 3 9.7l-.1-2.9 2.5-1.4 1.4-2.5 2.9.1Z"
        />
        <path
          d="m7.5 12 3 3 6-6"
          fill="none"
          stroke="white"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  return (
    <BadgeCheck
      size={15}
      className={cn("verification-badge", type)}
      aria-label={
        type === "business" ? "Business verified on X" : "Blue verified on X"
      }
    />
  );
}
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
  onEscapeKeyDown,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className={cn("dialog-content", className)}
          onEscapeKeyDown={onEscapeKeyDown}
        >
          <div className="dialog-heading">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description
                className={description ? "dialog-description" : "sr-only"}
              >
                {description || title}
              </Dialog.Description>
            </div>
            <Dialog.Close className="icon-button" aria-label="Close dialog">
              <X size={20} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-link"
    >
      {children}
      <ArrowUpRight size={14} />
    </a>
  );
}
