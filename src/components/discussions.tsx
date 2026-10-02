"use client";
import "./x-growth.css";
import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowUp,
  ArrowDown,
  MessageSquare,
  Bookmark,
  Ellipsis,
  Share2,
  Link2,
  Flag,
  ArrowUpRight,
  X,
  Send,
  Loader2,
  Pin,
  Check,
  ImagePlus,
  FileText,
  ChevronLeft,
  ChevronDown,
  Trash2,
  Maximize2,
  Minimize2,
  ShieldCheck,
} from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { toast } from "sonner";
import type { Post, Member, Community, Comment } from "@/lib/types";
import { cn, compactNumber, timeAgo } from "@/lib/utils";
import { Avatar, Badge, CommunityIcon, Empty, Modal } from "./ui";
import { CommunityPicker } from "./community-picker";
import { PostDetailSkeleton } from "./loading-skeletons";
import "./moderation-panel.css";

const MarkdownRenderer = lazy(() => import("./markdown"));

function Markdown({ children }: { children: string }) {
  return (
    <Suspense fallback={<p style={{ whiteSpace: "pre-wrap" }}>{children}</p>}>
      <MarkdownRenderer>{children}</MarkdownRenderer>
    </Suspense>
  );
}

export type Action = (
  action: string,
  payload?: Record<string, unknown>,
) => Promise<Record<string, unknown>>;
export type Navigate = (path: string) => void;

function ModerationNotice({
  moderation,
  onNavigate,
}: {
  moderation: { botId: string; category: string; message: string };
  onNavigate: Navigate;
}) {
  return (
    <div className="moderation-notice">
      <button onClick={() => onNavigate(`/u/${moderation.botId}`)}>
        <ShieldCheck size={14} aria-hidden="true" />
        @reddix <span>· Automated moderator</span>
      </button>
      <p>{moderation.message}</p>
    </div>
  );
}

function Vote({
  score,
  vote,
  onVote,
  disabled = false,
  small = false,
}: {
  score: number;
  vote: number;
  onVote: (value: number) => void;
  disabled?: boolean;
  small?: boolean;
}) {
  return (
    <div className={cn("vote-control", small && "small")}>
      <button
        aria-label="Upvote"
        aria-pressed={vote === 1}
        onClick={() => onVote(vote === 1 ? 0 : 1)}
        disabled={disabled}
        className={vote === 1 ? "voted" : ""}
      >
        <ArrowUp size={16} strokeWidth={2} />
      </button>
      <span>{compactNumber(score)}</span>
      <button
        aria-label="Downvote"
        aria-pressed={vote === -1}
        onClick={() => onVote(vote === -1 ? 0 : -1)}
        disabled={disabled}
        className={vote === -1 ? "voted" : ""}
      >
        <ArrowDown size={16} strokeWidth={2} />
      </button>
    </div>
  );
}
export function PostCard({
  post,
  member,
  onAction,
  onNavigate,
  detail = false,
  communityInfo,
  inCommunity = false,
}: {
  post: Post;
  member: Member;
  onAction: Action;
  onNavigate: Navigate;
  detail?: boolean;
  communityInfo?: Community;
  inCommunity?: boolean;
}) {
  const [reportOpen, setReportOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editBody, setEditBody] = useState(post.body);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reason, setReason] = useState("Spam or misleading content");
  const [busy, setBusy] = useState(false);
  const compact = !detail && member.preferences.density === "compact";
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const imageUrl = post.imageUrl !== failedImageUrl ? post.imageUrl : null;
  const isLinkPreview = post.type !== "image";
  const previewId = useId();
  const hasPreview = Boolean(post.body || imageUrl || post.url);
  useEffect(() => {
    setPreviewExpanded(false);
  }, [compact, post.id]);
  useEffect(() => {
    setFailedImageUrl(null);
  }, [post.id, post.imageUrl]);
  async function vote(value: number) {
    if (!member.eligible && value !== 0) {
      toast.info(
        "An active blue or business verification on X is needed to vote.",
      );
      return;
    }
    await onAction("vote", { postId: post.id, value }).catch(() => {});
  }
  async function share() {
    try {
      await navigator.clipboard.writeText(`${location.origin}/p/${post.id}`);
      toast.success("Link copied. Recipients will need to sign in.");
    } catch {
      toast.error("Couldn't copy the link. Please try again.");
    }
  }
  const community = (
    <button
      className="post-community"
      onClick={() => onNavigate(`/s/${post.communitySlug}`)}
    >
      s/{post.communitySlug}
    </button>
  );
  const preview = (
    <div
      id={previewId}
      className="post-preview"
      hidden={compact && !previewExpanded}
    >
      {detail || (compact && previewExpanded) ? (
        <div className="markdown post-body">
          <Markdown>{post.body}</Markdown>
        </div>
      ) : (
        post.body && (
          <p className="post-excerpt">{post.body.replace(/[#*`]/g, "")}</p>
        )
      )}
      {imageUrl && (
        <button
          className={cn("post-image", isLinkPreview && "post-link-banner")}
          onClick={() => onNavigate(`/p/${post.id}`)}
          aria-label={`Open ${isLinkPreview ? "link preview" : "image post"}: ${post.title}`}
        >
          <img
            src={imageUrl}
            alt={isLinkPreview ? `Link preview for ${post.title}` : post.title}
            loading="lazy"
            decoding="async"
            onError={() => setFailedImageUrl(imageUrl)}
          />
        </button>
      )}
      {post.url && (
        <a
          href={post.url}
          target="_blank"
          rel="noopener noreferrer"
          className="link-preview"
        >
          <div className="link-preview-icon">
            <Link2 size={21} />
          </div>
          <span>
            <strong>
              {(() => {
                try {
                  return new URL(post.url).hostname.replace(/^www\./, "");
                } catch {
                  return "External link";
                }
              })()}
            </strong>
          </span>
          <ArrowUpRight size={18} />
        </a>
      )}
    </div>
  );
  return (
    <article
      className={cn(
        "post-card",
        detail && "post-card-detail",
        compact && "post-card-compact",
        post.isPinned && "is-pinned",
      )}
    >
      {compact && (
        <button
          className="post-thumbnail"
          aria-label={`Open ${imageUrl && isLinkPreview ? "link preview" : "post"}: ${post.title}`}
          onClick={() => onNavigate(`/p/${post.id}`)}
        >
          {imageUrl ? (
            <img
              src={imageUrl}
              alt=""
              loading="lazy"
              decoding="async"
              onError={() => setFailedImageUrl(imageUrl)}
            />
          ) : post.url || (isLinkPreview && post.imageUrl) ? (
            <Link2 size={27} strokeWidth={1.5} />
          ) : (
            <FileText size={27} strokeWidth={1.5} />
          )}
        </button>
      )}
      <div className="post-card-content">
        {post.isPinned && (
          <div className="pinned-label">
            <Pin size={12} /> COMMUNITY NOTE
          </div>
        )}
        <div className="post-meta">
          <button
            className="post-identity-icon"
            onClick={() =>
              onNavigate(
                inCommunity
                  ? `/u/${post.author.id}`
                  : `/s/${post.communitySlug}`,
              )
            }
            aria-label={
              inCommunity
                ? `View ${post.author.name}`
                : `Visit s/${post.communitySlug}`
            }
          >
            {inCommunity || !communityInfo ? (
              <Avatar member={post.author} size="small" />
            ) : (
              <CommunityIcon
                slug={communityInfo.slug}
                name={communityInfo.name}
                icon={communityInfo.icon}
              />
            )}
          </button>
          <div className="post-identity">
            <div className="post-identity-line">
              {inCommunity ? (
                <>
                  <button
                    className="post-author"
                    onClick={() => onNavigate(`/u/${post.author.id}`)}
                  >
                    {post.author.name}
                  </button>
                  <Badge type={post.author.verificationType} />
                </>
              ) : (
                community
              )}
              {post.authorIsLeader && (
                <span
                  className="discussion-leader"
                  title="Verified through the organization’s official X Affiliates list"
                >
                  Discussion leader
                </span>
              )}
              <span className="meta-dot">·</span>
              <time className="meta-time" dateTime={post.createdAt}>
                {timeAgo(post.createdAt)}
              </time>
            </div>
            {!inCommunity && (
              <div className="post-byline">
                <button onClick={() => onNavigate(`/u/${post.author.id}`)}>
                  {post.author.name}
                </button>
                <Badge type={post.author.verificationType} />
              </div>
            )}
          </div>
          {!detail &&
            !inCommunity &&
            communityInfo &&
            !communityInfo.isFollowing && (
              <button
                className="post-join"
                onClick={() =>
                  void onAction("follow", {
                    communityId: post.communityId,
                    following: true,
                  }).catch(() => {})
                }
              >
                Join
              </button>
            )}
          {(post.status === "published" || post.author.id === member.id) && (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger
                className="icon-button post-menu"
                aria-label="Post options"
              >
                <Ellipsis size={18} />
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="dropdown-content" align="end">
                  {post.status === "published" && (
                    <DropdownMenu.Item onSelect={() => setReportOpen(true)}>
                      <Flag size={15} /> Report post
                    </DropdownMenu.Item>
                  )}
                  {post.author.id === member.id &&
                    member.eligible &&
                    post.status === "published" && (
                      <DropdownMenu.Item onSelect={() => setEditOpen(true)}>
                        <FileText size={15} />
                        Edit your post
                      </DropdownMenu.Item>
                    )}
                  {post.author.id === member.id && post.promoteOnX && (
                    <DropdownMenu.Item
                      onSelect={() =>
                        void onAction("withdrawXPromotion", { postId: post.id })
                          .then(() =>
                            toast.success(
                              "Future X promotion stopped. Existing X posts may remain.",
                            ),
                          )
                          .catch(() => {})
                      }
                    >
                      Stop featuring on X
                    </DropdownMenu.Item>
                  )}
                  {post.author.id === member.id && (
                    <DropdownMenu.Item onSelect={() => setDeleteOpen(true)}>
                      <Trash2 size={15} /> Delete your post
                    </DropdownMenu.Item>
                  )}
                  {member.isAdmin && post.status === "published" && (
                    <DropdownMenu.Item
                      onSelect={() =>
                        void onAction("adminLockPost", {
                          postId: post.id,
                          locked: !post.locked,
                        }).catch(() => {})
                      }
                    >
                      {post.locked
                        ? "Unlock conversation"
                        : "Lock conversation"}
                    </DropdownMenu.Item>
                  )}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          )}
        </div>
        <button
          className="post-title-button"
          onClick={() => !detail && onNavigate(`/p/${post.id}`)}
        >
          <h2>{post.title}</h2>
        </button>
        {post.status === "removed" && post.moderation ? (
          <ModerationNotice
            moderation={post.moderation}
            onNavigate={onNavigate}
          />
        ) : (
          post.status === "published" && !compact && preview
        )}
        {detail && post.status === "published" && !!post.tags.length && (
          <div className="post-tags">
            {post.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        )}
        <div className="post-actions">
          {compact && (
            <button
              className="post-action preview-toggle"
              aria-label={
                previewExpanded ? "Collapse preview" : "Expand preview"
              }
              title={previewExpanded ? "Collapse preview" : "Expand preview"}
              aria-expanded={previewExpanded}
              aria-controls={previewId}
              disabled={!hasPreview || post.status !== "published"}
              onClick={() => setPreviewExpanded((expanded) => !expanded)}
            >
              {previewExpanded ? (
                <Minimize2 size={16} />
              ) : (
                <Maximize2 size={16} />
              )}
            </button>
          )}
          <Vote
            score={post.score}
            vote={post.myVote}
            onVote={(v) => void vote(v)}
            disabled={post.status !== "published"}
          />
          <button
            className="post-action comments-action"
            onClick={() => onNavigate(`/p/${post.id}`)}
          >
            {!compact && <MessageSquare size={16} />}
            <span>
              {post.commentCount}
              <span className="action-word">
                {" "}
                {post.commentCount === 1 ? "comment" : "comments"}
              </span>
            </span>
          </button>
          <button
            className="post-action share-action"
            onClick={() => void share()}
          >
            {!compact && <Share2 size={16} />}
            <span>Share</span>
          </button>
          <button
            className={cn("post-action save-action", post.isSaved && "active")}
            disabled={!post.isSaved && post.status !== "published"}
            onClick={() =>
              void onAction("save", {
                postId: post.id,
                saved: !post.isSaved,
              }).catch(() => {})
            }
          >
            {!compact && (
              <Bookmark
                size={16}
                fill={post.isSaved ? "currentColor" : "none"}
              />
            )}
            <span>{post.isSaved ? "Saved" : "Save"}</span>
          </button>
          {compact && post.status === "published" && (
            <button
              className="post-action report-action"
              onClick={() => setReportOpen(true)}
            >
              Report
            </button>
          )}
        </div>
        {compact && post.status === "published" && preview}
      </div>
      <Modal
        open={reportOpen}
        onOpenChange={setReportOpen}
        title="Report this post"
        description="Your report goes privately to the Reddix admins."
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await onAction("report", {
                targetType: "post",
                targetId: post.id,
                reason,
              });
              setReportOpen(false);
              toast.success(
                "Report received. Thank you for looking out for the community.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>Reason</label>
          <select value={reason} onChange={(e) => setReason(e.target.value)}>
            {[
              "Spam or misleading content",
              "Harassment",
              "Privacy violation",
              "Scam",
              "Off-topic",
              "Other",
            ].map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <button disabled={busy} className="button primary full modal-submit">
            Send report
          </button>
        </form>
      </Modal>
      <Modal open={editOpen} onOpenChange={setEditOpen} title="Edit your post">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await onAction("editPost", { postId: post.id, body: editBody });
              setEditOpen(false);
              toast.success("Post updated.");
            } catch {
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>Title</label>
          <input value={post.title} readOnly />
          <p className="field-hint">
            Post titles stay fixed. You can update the body below.
          </p>
          <label htmlFor="edit-post-body">Body</label>
          <textarea
            id="edit-post-body"
            rows={8}
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            maxLength={20000}
          />
          <button className="button primary full modal-submit" disabled={busy}>
            Save changes
          </button>
        </form>
      </Modal>
      <Modal
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this post?"
        description="The post content will be removed. Replies may remain in the conversation."
      >
        <div className="compose-footer">
          <button
            className="button secondary"
            onClick={() => setDeleteOpen(false)}
          >
            Keep post
          </button>
          <button
            className="button primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onAction("deletePost", { postId: post.id });
                setDeleteOpen(false);
                if (detail) onNavigate("/popular");
                toast.success("Post deleted.");
              } catch {
              } finally {
                setBusy(false);
              }
            }}
          >
            Delete post
          </button>
        </div>
      </Modal>
    </article>
  );
}

export function ComposePost({
  open,
  onClose,
  communities,
  member,
  onAction,
  onNavigate,
  defaultCommunity,
}: {
  open: boolean;
  onClose: () => void;
  communities: Community[];
  member: Member;
  onAction: Action;
  onNavigate: Navigate;
  defaultCommunity?: string;
}) {
  const [type, setType] = useState<"text" | "link" | "image">("text");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [communityPickerOpen, setCommunityPickerOpen] = useState(false);
  const [community, setCommunity] = useState(
    defaultCommunity ||
      communities.find((c) => c.isFollowing && !c.archived)?.id ||
      communities.find((c) => !c.archived)?.id ||
      "",
  );
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  useEffect(() => {
    if (defaultCommunity) setCommunity(defaultCommunity);
  }, [defaultCommunity]);
  useEffect(() => {
    if (!open) setCommunityPickerOpen(false);
  }, [open]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await onAction("createPost", {
        communityId: community,
        title,
        body,
        type,
        url: type === "link" ? url : undefined,
        imageUrl: type === "image" ? imageUrl : undefined,
        promoteOnX: false,
      });
      setTitle("");
      setBody("");
      setUrl("");
      setImageUrl(null);
      onClose();
      onNavigate("/new");
      toast.success("Your conversation is live.");
    } catch {
    } finally {
      setBusy(false);
    }
  }
  async function upload(file?: File) {
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      toast.error("Choose an image smaller than 4 MB.");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch("/api/media", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Upload unavailable");
      setImageUrl(data.url || data.imageUrl);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }
  return (
    <Modal
      open={open}
      onOpenChange={(v) => !v && onClose()}
      className="compose-dialog"
      title="Start a conversation"
      description="Share a question, a discovery, or something you’re building."
      onEscapeKeyDown={(event) => {
        if (communityPickerOpen) event.preventDefault();
      }}
    >
      {!member.eligible ? (
        <Empty
          title="Your voice belongs here."
          description="Posting requires a current blue or business verification on X. Update your X account, then resync in Settings."
          action={
            <button
              className="button primary"
              onClick={() => {
                onClose();
                onNavigate("/settings");
              }}
            >
              Go to settings <ArrowUpRight size={16} />
            </button>
          }
        />
      ) : (
        <form onSubmit={submit}>
          <CommunityPicker
            communities={communities}
            value={community}
            onChange={setCommunity}
            open={communityPickerOpen}
            onOpenChange={setCommunityPickerOpen}
          />
          <div className="compose-tabs" role="group" aria-label="Post type">
            {(
              [
                { id: "text", name: "Text", icon: FileText },
                { id: "link", name: "Link", icon: Link2 },
                { id: "image", name: "Image", icon: ImagePlus },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                className={cn(type === t.id && "active")}
                aria-pressed={type === t.id}
                onClick={() => setType(t.id)}
              >
                <t.icon size={16} aria-hidden="true" />
                {t.name}
              </button>
            ))}
          </div>
          <label className="sr-only" htmlFor="post-title">
            Title
          </label>
          <input
            id="post-title"
            className="compose-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={300}
            placeholder="An interesting title"
            required
          />
          <span className="input-count">{title.length}/300</span>
          <div className="compose-fields">
            {type === "link" && (
              <div>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://"
                  required
                  aria-label="Link URL"
                  aria-describedby="post-link-hint"
                />
                <p id="post-link-hint" className="field-hint">
                  A preview image will be added when available.
                </p>
              </div>
            )}
            {type === "image" && (
              <div className="compose-image">
                <label
                  className={cn("upload-zone", imageUrl && "has-image")}
                  aria-busy={uploading}
                >
                  <input
                    className="sr-only"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    aria-label={imageUrl ? "Change image" : "Choose an image"}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      void upload(file);
                    }}
                    disabled={uploading || busy}
                  />
                  {imageUrl ? (
                    <img className="upload-preview" src={imageUrl} alt="" />
                  ) : (
                    <span className="upload-icon" aria-hidden="true">
                      <ImagePlus size={24} strokeWidth={1.5} />
                    </span>
                  )}
                  <span className="upload-copy" role="status">
                    <span>
                      {uploading && (
                        <Loader2
                          size={16}
                          className="spin"
                          aria-hidden="true"
                        />
                      )}
                      {uploading
                        ? "Uploading image…"
                        : imageUrl
                          ? "Image ready to post"
                          : "Choose an image"}
                    </span>
                    {imageUrl && !uploading && <small>Click to change</small>}
                  </span>
                </label>
                {imageUrl && (
                  <button
                    type="button"
                    className="upload-remove"
                    onClick={() => setImageUrl(null)}
                    disabled={uploading || busy}
                  >
                    <X size={14} aria-hidden="true" />
                    Remove image
                  </button>
                )}
              </div>
            )}
            <label className="sr-only" htmlFor="post-body">
              Post body
            </label>
            <textarea
              id="post-body"
              rows={type === "text" ? 7 : 4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={
                type === "text"
                  ? "What’s on your mind?"
                  : "Add a little context (optional)"
              }
              maxLength={20000}
              required={type === "text"}
            />
          </div>
          <div className="compose-footer">
            <button
              className="button primary"
              disabled={
                busy ||
                uploading ||
                !communities.some((c) => c.id === community && !c.archived) ||
                !title.trim() ||
                (type === "image" && !imageUrl)
              }
            >
              {busy ? (
                <Loader2 size={16} className="spin" />
              ) : (
                <ArrowUpRight size={16} />
              )}
              Publish post
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export function PostDetail({
  id,
  member,
  onAction,
  onNavigate,
  revision,
}: {
  id: string;
  member: Member;
  onAction: Action;
  onNavigate: Navigate;
  revision: number;
}) {
  const [post, setPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [sort, setSort] = useState("top");
  const [editingComment, setEditingComment] = useState<Comment | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [deletingComment, setDeletingComment] = useState<Comment | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/posts/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok)
          throw new Error(
            d.error?.message || "This conversation is unavailable.",
          );
        if (!controller.signal.aborted) {
          setPost(d.post);
          setComments(d.comments);
          setError(null);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError({ id, message: e.message });
      });
    return () => controller.abort();
  }, [id, revision]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await onAction("comment", { postId: id, parentId: replyTo, body });
      setBody("");
      setReplyTo(null);
      toast.success("Reply added.");
    } catch {
    } finally {
      setBusy(false);
    }
  }
  function commentTree(parent: string | null, depth = 0): React.ReactNode {
    return comments
      .filter((c) => c.parentId === parent)
      .sort((a, b) =>
        sort === "top"
          ? b.score - a.score
          : +new Date(b.createdAt) - +new Date(a.createdAt),
      )
      .map((c) => (
        <div
          className="comment"
          key={c.id}
          style={{ "--depth": Math.min(depth, 4) } as React.CSSProperties}
        >
          <div className="comment-head">
            <Avatar member={c.author} size="small" />
            <button onClick={() => onNavigate(`/u/${c.author.id}`)}>
              {c.author.name}
            </button>
            <Badge type={c.author.verificationType} />
            {c.authorIsLeader && (
              <span
                className="discussion-leader"
                title="Verified through the organization’s official X Affiliates list"
              >
                Discussion leader
              </span>
            )}
            <span>{timeAgo(c.createdAt)}</span>
            <button
              className="icon-button"
              aria-label={
                collapsed.has(c.id) ? "Expand replies" : "Collapse replies"
              }
              aria-expanded={!collapsed.has(c.id)}
              onClick={() =>
                setCollapsed((old) => {
                  const next = new Set(old);
                  if (next.has(c.id)) next.delete(c.id);
                  else next.add(c.id);
                  return next;
                })
              }
            >
              <ChevronDown
                size={13}
                style={{
                  transform: collapsed.has(c.id) ? "rotate(-90deg)" : undefined,
                }}
              />
            </button>
          </div>
          {!collapsed.has(c.id) && (
            <>
              {c.status === "removed" && c.moderation ? (
                <ModerationNotice
                  moderation={c.moderation}
                  onNavigate={onNavigate}
                />
              ) : (
                <div className="markdown comment-body">
                  <Markdown>
                    {c.status === "published" ? c.body : `[${c.status}]`}
                  </Markdown>
                </div>
              )}
              <div className="comment-actions">
                {c.status === "published" && (
                  <>
                    <Vote
                      small
                      score={c.score}
                      vote={c.myVote}
                      onVote={(v) =>
                        void onAction("vote", {
                          commentId: c.id,
                          value: v,
                        }).catch(() => {})
                      }
                    />
                    {member.eligible &&
                      post?.status === "published" &&
                      !post.locked && (
                        <button
                          onClick={() => {
                            setReplyTo(c.id);
                            document.getElementById("comment-input")?.focus();
                          }}
                        >
                          <MessageSquare size={14} />
                          Reply
                        </button>
                      )}
                    <button
                      aria-label="Report comment"
                      onClick={() =>
                        void onAction("report", {
                          targetType: "comment",
                          targetId: c.id,
                          reason: "Needs moderator review",
                        })
                          .then(() =>
                            toast.success("Report sent privately to admins."),
                          )
                          .catch(() => {})
                      }
                    >
                      <Flag size={13} />
                    </button>
                    {c.author.id === member.id && (
                      <>
                        {member.eligible &&
                          post?.status === "published" &&
                          !post.locked && (
                            <button
                              onClick={() => {
                                setEditingComment(c);
                                setCommentDraft(c.body);
                              }}
                            >
                              Edit
                            </button>
                          )}
                        <button onClick={() => setDeletingComment(c)}>
                          Delete
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
              {commentTree(c.id, depth + 1)}
            </>
          )}
        </div>
      ));
  }
  if (error?.id === id)
    return (
      <Empty
        title="Conversation unavailable"
        description={error.message}
        action={
          <button
            className="button secondary"
            onClick={() => onNavigate("/popular")}
          >
            Back to the feed
          </button>
        }
      />
    );
  if (!post || post.id !== id) return <PostDetailSkeleton />;
  return (
    <div className="post-detail">
      <Modal
        open={!!editingComment}
        onOpenChange={(v) => !v && setEditingComment(null)}
        title="Edit your reply"
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!editingComment) return;
            setBusy(true);
            try {
              await onAction("editComment", {
                commentId: editingComment.id,
                body: commentDraft,
              });
              setEditingComment(null);
              toast.success("Reply updated.");
            } catch {
            } finally {
              setBusy(false);
            }
          }}
        >
          <label htmlFor="edit-comment-body">Reply</label>
          <textarea
            id="edit-comment-body"
            rows={6}
            value={commentDraft}
            onChange={(e) => setCommentDraft(e.target.value)}
            maxLength={10000}
            required
          />
          <button
            className="button primary full modal-submit"
            disabled={busy || !commentDraft.trim()}
          >
            Save reply
          </button>
        </form>
      </Modal>
      <Modal
        open={!!deletingComment}
        onOpenChange={(v) => !v && setDeletingComment(null)}
        title="Delete your reply?"
        description="Your reply will be removed. Other members’ replies will stay in the conversation."
      >
        <div className="compose-footer">
          <button
            className="button secondary"
            onClick={() => setDeletingComment(null)}
          >
            Keep reply
          </button>
          <button
            className="button primary"
            disabled={busy}
            onClick={async () => {
              if (!deletingComment) return;
              setBusy(true);
              try {
                await onAction("deleteComment", {
                  commentId: deletingComment.id,
                });
                setDeletingComment(null);
                toast.success("Reply deleted.");
              } catch {
              } finally {
                setBusy(false);
              }
            }}
          >
            Delete reply
          </button>
        </div>
      </Modal>
      <button
        className="back-link"
        onClick={() => onNavigate(`/s/${post.communitySlug}`)}
      >
        <ChevronLeft size={16} />
        Back to s/{post.communitySlug}
      </button>
      <PostCard
        post={post}
        member={member}
        onAction={onAction}
        onNavigate={onNavigate}
        detail
      />
      <div className="comments-section">
        <div className="section-heading">
          <h3>
            The conversation <span>{post.commentCount}</span>
          </h3>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            aria-label="Sort comments"
          >
            <option value="top">Top comments</option>
            <option value="new">Newest first</option>
          </select>
        </div>
        {member.eligible && post.status === "published" && !post.locked ? (
          <form className="comment-composer" onSubmit={submit}>
            {replyTo && (
              <div className="replying-to">
                Replying to{" "}
                {comments.find((c) => c.id === replyTo)?.author.name}
                <button
                  type="button"
                  onClick={() => setReplyTo(null)}
                  aria-label="Cancel reply"
                >
                  <X size={14} />
                </button>
              </div>
            )}
            <textarea
              id="comment-input"
              rows={3}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Add something to the conversation…"
              maxLength={10000}
              required
            />
            <div>
              <span>Keep it thoughtful. Keep it human.</span>
              <button
                className="button primary small"
                disabled={busy || !body.trim()}
              >
                <Send size={14} />
                Reply
              </button>
            </div>
          </form>
        ) : (
          <div className="browse-notice">
            {post.status !== "published"
              ? "This post was removed. Existing replies remain readable."
              : post.locked
                ? "This conversation is locked."
                : "Verify on X and resync your profile to join the conversation."}
          </div>
        )}
        {comments.length ? (
          <div className="comment-list">{commentTree(null)}</div>
        ) : (
          <Empty
            title="The floor is yours."
            description="Be the first to add a thought or a question."
          />
        )}
      </div>
    </div>
  );
}
