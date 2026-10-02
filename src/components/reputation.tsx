import { ArrowUpRight } from "lucide-react";
import type { Reputation } from "@/lib/types";
import { compactNumber } from "@/lib/utils";
import "./reputation.css";

const reputationNumber = new Intl.NumberFormat("en-US");

export function ReputationSummary({ reputation }: { reputation: Reputation }) {
  return (
    <div className="profile-reputation" role="group" aria-label="Reputation">
      <dl className="reputation-stats">
        <div className="reputation-total">
          <dt>
            <ArrowUpRight size={15} aria-hidden="true" /> Reputation
          </dt>
          <dd>{reputationNumber.format(reputation.total)}</dd>
        </div>
        <div>
          <dt>Post reputation</dt>
          <dd>{reputationNumber.format(reputation.posts)}</dd>
        </div>
        <div>
          <dt>Comment reputation</dt>
          <dd>{reputationNumber.format(reputation.comments)}</dd>
        </div>
      </dl>
      <p className="reputation-explanation">
        Other members’ upvotes add 1; downvotes subtract 1. Post and comment
        reputation each stop at 0. Only published posts and comments count.
        Self-votes are excluded.
      </p>
    </div>
  );
}

export function ReputationIndicator({ total }: { total: number }) {
  const label = `${reputationNumber.format(total)} reputation`;
  return (
    <span className="sidebar-reputation" title={label}>
      <ArrowUpRight size={12} aria-hidden="true" />
      <span aria-hidden="true">{compactNumber(total)} reputation</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
