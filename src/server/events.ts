import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Member } from "@/lib/types";
import { sql } from "./db";
import {
  DomainError,
  isFreshEligible,
  requireEligible,
  rsvpDecision,
  safeHttpsUrl,
} from "./domain";
import { memberFromRow } from "./members";
import { canReadEvent, getEvents } from "./queries";

export const createEventSchema = z.object({
  title: z.string().trim().min(3).max(180),
  description: z.string().trim().min(10).max(20000),
  source: z.enum(["native", "external"]).default("native"),
  externalUrl: z.string().optional(),
  sourceLabel: z.string().trim().max(80).optional(),
  city: z.string().trim().min(1).max(80),
  timezone: z.string().refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Choose a valid timezone."),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  venue: z.string().trim().max(200).default(""),
  exactAddress: z.string().trim().max(500).optional(),
  venueDisclosure: z.enum(["all", "attendees", "later"]).default("attendees"),
  format: z.enum(["in_person", "online"]).default("in_person"),
  visibility: z.enum(["listed", "unlisted", "invited"]).default("listed"),
  capacity: z.number().int().min(1).max(100000).nullable().optional(),
  requiresApproval: z.boolean().default(false),
  waitlistEnabled: z.boolean().default(true),
  communityId: z.string().optional().nullable(),
  tags: z.array(z.string().trim().min(1).max(40)).max(5).default([]),
  coverStyle: z.string().max(32).default("grid"),
});

export async function createEvent(member: Member, input: unknown) {
  requireEligible(member);
  const data = createEventSchema.parse(input);
  if (new Date(data.startsAt).getTime() <= Date.now())
    throw new DomainError(
      "VALIDATION_ERROR",
      "Your event must start in the future.",
      422,
    );
  if (new Date(data.endsAt) <= new Date(data.startsAt))
    throw new DomainError(
      "VALIDATION_ERROR",
      "The end time must be after the start time.",
      422,
    );
  const externalUrl =
    data.source === "external" ? safeHttpsUrl(data.externalUrl ?? "") : null;
  if (data.communityId) {
    const [community] =
      await sql`SELECT id FROM communities WHERE id=${data.communityId} AND archived=false`;
    if (!community)
      throw new DomainError(
        "VALIDATION_ERROR",
        "Choose an active community.",
        422,
      );
  }
  const id = randomUUID();
  await sql`INSERT INTO events(id,host_id,title,description,source,external_url,source_label,city,timezone,starts_at,ends_at,venue,exact_address,
    venue_disclosure,format,visibility,capacity,requires_approval,waitlist_enabled,cover_style,community_id,tags)
    VALUES(${id},${member.id},${data.title},${data.description},${data.source},${externalUrl},${data.sourceLabel ?? (externalUrl ? new URL(externalUrl).hostname : null)},
      ${data.city},${data.timezone},${data.startsAt},${data.endsAt},${data.venue},${data.exactAddress ?? null},${data.venueDisclosure},${data.format},${data.visibility},
      ${data.source === "native" ? (data.capacity ?? null) : null},${data.source === "native" && data.requiresApproval},${data.waitlistEnabled},${data.coverStyle},${data.communityId ?? null},${sql.json(data.tags)})`;
  return { event: (await getEvents(member.id, id))[0] };
}

export async function changeRsvp(member: Member, input: unknown) {
  const data = z
    .object({
      eventId: z.string(),
      state: z.enum(["going", "canceled", "interested"]),
      publicAttendance: z.boolean().optional(),
    })
    .parse(input);
  if (data.state !== "canceled") requireEligible(member);
  if (
    data.state !== "canceled" &&
    !(await canReadEvent(member.id, data.eventId))
  )
    throw new DomainError(
      "RESOURCE_NOT_FOUND",
      "This event is unavailable.",
      404,
    );
  const status = await sql.begin(async (tx) => {
    const [event] =
      await tx`SELECT * FROM events WHERE id=${data.eventId} FOR UPDATE`;
    if (!event)
      throw new DomainError(
        "RESOURCE_NOT_FOUND",
        "This event is unavailable.",
        404,
      );
    const [previous] =
      await tx`SELECT * FROM event_rsvps WHERE event_id=${data.eventId} AND user_id=${member.id}`;
    if (data.state === "canceled") {
      if (!previous) return "none";
      await tx`UPDATE event_rsvps SET status='canceled',approved=false,revision=revision+1,updated_at=now() WHERE event_id=${data.eventId} AND user_id=${member.id}`;
      if (
        previous.status === "going" &&
        event.source === "native" &&
        event.status === "published" &&
        !event.registration_closed &&
        new Date(event.starts_at).getTime() > Date.now()
      ) {
        const [counts] =
          await tx`SELECT count(*) going FROM event_rsvps WHERE event_id=${data.eventId} AND status='going'`;
        let free =
          event.capacity === null
            ? Infinity
            : Number(event.capacity) - Number(counts.going);
        const waiters =
          await tx`SELECT r.*,row_to_json(u) person FROM event_rsvps r JOIN users u ON u.id=r.user_id
          WHERE r.event_id=${data.eventId} AND r.status='waitlisted' ORDER BY r.created_at,r.user_id FOR UPDATE OF r`;
        for (const waiter of waiters) {
          if (free <= 0) break;
          if (
            !isFreshEligible(memberFromRow(waiter.person)) ||
            !waiter.person.onboarding_completed_at ||
            (event.requires_approval && !waiter.approved)
          )
            continue;
          const [blockedHost] =
            await tx`SELECT user_id FROM blocks WHERE user_id=${waiter.user_id} AND blocked_id=${event.host_id}`;
          if (blockedHost) continue;
          if (event.visibility === "invited") {
            const [allowed] =
              await tx`SELECT user_id FROM event_invitations WHERE event_id=${data.eventId} AND user_id=${waiter.user_id}`;
            if (!allowed && event.host_id !== waiter.user_id) continue;
          }
          await tx`UPDATE event_rsvps SET status='going',updated_at=now() WHERE event_id=${data.eventId} AND user_id=${waiter.user_id}`;
          await tx`INSERT INTO notifications(id,user_id,type,message,resource_id,dedupe_key) VALUES(${randomUUID()},${waiter.user_id},'event',
            'A place opened up. Your event registration is now confirmed.',${data.eventId},${`promoted:${data.eventId}:${waiter.user_id}:${waiter.revision}`}) ON CONFLICT DO NOTHING`;
          free--;
        }
      }
      return "canceled";
    }
    if (
      event.status !== "published" ||
      event.registration_closed ||
      new Date(event.starts_at).getTime() <= Date.now()
    )
      throw new DomainError(
        "EVENT_CLOSED",
        "Registration for this event is closed.",
        409,
      );
    if (
      previous &&
      ["going", "pending_approval", "waitlisted", "interested"].includes(
        previous.status,
      )
    ) {
      if (event.source === "native" || previous.status === data.state)
        return previous.status as string;
    }
    if (event.source === "native" && data.state === "interested")
      throw new DomainError(
        "VALIDATION_ERROR",
        "Choose RSVP to register for this event.",
        422,
      );
    const [counts] =
      await tx`SELECT count(*) going FROM event_rsvps WHERE event_id=${data.eventId} AND status='going'`;
    const next =
      event.source === "external"
        ? data.state
        : rsvpDecision({
            full:
              event.capacity !== null && Number(counts.going) >= event.capacity,
            approvalRequired: event.requires_approval,
            approved: false,
            waitlistEnabled: event.waitlist_enabled,
          });
    await tx`INSERT INTO event_rsvps(event_id,user_id,status,public_attendance) VALUES(${data.eventId},${member.id},${next},${data.publicAttendance ?? member.preferences.publicAttendance})
      ON CONFLICT(event_id,user_id) DO UPDATE SET status=EXCLUDED.status,approved=false,public_attendance=EXCLUDED.public_attendance,
      revision=event_rsvps.revision+1,created_at=now(),updated_at=now()`;
    await tx`INSERT INTO notifications(id,user_id,type,message,resource_id) VALUES(${randomUUID()},${member.id},'event',
      ${next === "going" ? (event.source === "external" ? "Your self-reported event interest was saved on Reddix. Complete your RSVP with the event provider." : "You're on the guest list. Your RSVP is confirmed.") : next === "pending_approval" ? "Your RSVP request has been sent to the host." : next === "waitlisted" ? "You're on the waitlist. We'll notify you when a place opens up." : "Your interest was saved on Reddix."},${data.eventId})`;
    return next;
  });
  return {
    status,
    event: (await getEvents(member.id, data.eventId))[0] ?? null,
  };
}

export async function reviewRsvp(member: Member, input: unknown) {
  requireEligible(member);
  const data = z
    .object({
      eventId: z.string(),
      memberId: z.string(),
      decision: z.enum(["approved", "declined"]),
    })
    .parse(input);
  const status = await sql.begin(async (tx) => {
    const [event] =
      await tx`SELECT * FROM events WHERE id=${data.eventId} FOR UPDATE`;
    if (!event || event.host_id !== member.id)
      throw new DomainError(
        "FORBIDDEN",
        "Only the event host can review registrations.",
        403,
      );
    if (
      event.source !== "native" ||
      event.status !== "published" ||
      event.registration_closed ||
      new Date(event.starts_at).getTime() <= Date.now()
    )
      throw new DomainError(
        "EVENT_CLOSED",
        "Registration for this event is closed.",
        409,
      );
    const [guest] =
      await tx`SELECT * FROM event_rsvps WHERE event_id=${data.eventId} AND user_id=${data.memberId}`;
    if (!guest || !["pending_approval", "waitlisted"].includes(guest.status))
      throw new DomainError(
        "VERSION_CONFLICT",
        "This registration is no longer awaiting a decision.",
        409,
      );
    let next = "declined";
    if (data.decision === "approved") {
      const [user] = await tx`SELECT * FROM users WHERE id=${data.memberId}`;
      if (!user || !isFreshEligible(memberFromRow(user)))
        throw new DomainError(
          "VERIFICATION_REQUIRED",
          "This guest needs to refresh their X verification before approval.",
          409,
        );
      const [blockedHost] =
        await tx`SELECT user_id FROM blocks WHERE user_id=${data.memberId} AND blocked_id=${event.host_id}`;
      if (blockedHost)
        throw new DomainError(
          "EVENT_CLOSED",
          "This guest cannot register at this time.",
          409,
        );
      const [counts] =
        await tx`SELECT count(*) going FROM event_rsvps WHERE event_id=${data.eventId} AND status='going'`;
      next = rsvpDecision({
        full: event.capacity !== null && Number(counts.going) >= event.capacity,
        approvalRequired: event.requires_approval,
        approved: true,
        waitlistEnabled: event.waitlist_enabled,
      });
    }
    await tx`UPDATE event_rsvps SET status=${next},approved=${data.decision === "approved"},updated_at=now() WHERE event_id=${data.eventId} AND user_id=${data.memberId}`;
    await tx`INSERT INTO notifications(id,user_id,type,message,resource_id) VALUES(${randomUUID()},${data.memberId},'event',
      ${next === "going" ? "Your event RSVP has been approved." : next === "waitlisted" ? "Your request was approved and you are on the waitlist." : "The event host was unable to approve your RSVP."},${data.eventId})`;
    return next;
  });
  return { status };
}

export async function cancelEvent(member: Member, eventId: string) {
  await sql.begin(async (tx) => {
    const [event] =
      await tx`SELECT * FROM events WHERE id=${eventId} FOR UPDATE`;
    if (!event || (event.host_id !== member.id && !member.isAdmin))
      throw new DomainError(
        "FORBIDDEN",
        "Only the host can cancel this event.",
        403,
      );
    if (event.status === "canceled") return;
    await tx`UPDATE events SET status='canceled',revision=revision+1,updated_at=now() WHERE id=${eventId}`;
    const guests =
      await tx`SELECT user_id FROM event_rsvps WHERE event_id=${eventId} AND status IN ('going','waitlisted','pending_approval')`;
    for (const guest of guests)
      await tx`INSERT INTO notifications(id,user_id,type,message,resource_id,dedupe_key) VALUES(${randomUUID()},${guest.user_id},'event',
      'An event you registered for has been canceled.',${eventId},${`cancel:${eventId}:${guest.user_id}`}) ON CONFLICT DO NOTHING`;
  });
  return { canceled: true };
}

export async function eventUpdate(member: Member, input: unknown) {
  requireEligible(member);
  const data = z
    .object({ eventId: z.string(), body: z.string().trim().min(1).max(5000) })
    .parse(input);
  await sql.begin(async (tx) => {
    const [event] =
      await tx`SELECT * FROM events WHERE id=${data.eventId} FOR UPDATE`;
    if (!event || event.host_id !== member.id)
      throw new DomainError(
        "FORBIDDEN",
        "Only the host can send event updates.",
        403,
      );
    if (event.status !== "published")
      throw new DomainError("EVENT_CLOSED", "This event is canceled.", 409);
    const id = randomUUID();
    await tx`INSERT INTO event_updates(id,event_id,author_id,body) VALUES(${id},${data.eventId},${member.id},${data.body})`;
    const guests =
      await tx`SELECT user_id FROM event_rsvps WHERE event_id=${data.eventId} AND status IN ('going','waitlisted','pending_approval')`;
    for (const guest of guests)
      await tx`INSERT INTO notifications(id,user_id,type,message,resource_id,dedupe_key) VALUES(${randomUUID()},${guest.user_id},'event',
      'The host shared an update for your event. Open the event to read it.',${data.eventId},${`update:${id}:${guest.user_id}`}) ON CONFLICT DO NOTHING`;
  });
  return { sent: true };
}

export async function editEvent(member: Member, input: unknown) {
  requireEligible(member);
  const data = z
    .object({
      eventId: z.string(),
      revision: z.number().int().optional(),
      title: z.string().trim().min(3).max(180).optional(),
      description: z.string().trim().min(10).max(20000).optional(),
      startsAt: z.iso.datetime({ offset: true }).optional(),
      endsAt: z.iso.datetime({ offset: true }).optional(),
      venue: z.string().trim().max(200).optional(),
      exactAddress: z.string().trim().max(500).nullable().optional(),
      capacity: z.number().int().min(1).max(100000).nullable().optional(),
    })
    .parse(input);
  await sql.begin(async (tx) => {
    const [event] =
      await tx`SELECT * FROM events WHERE id=${data.eventId} FOR UPDATE`;
    if (!event || event.host_id !== member.id)
      throw new DomainError(
        "FORBIDDEN",
        "Only the host can edit this event.",
        403,
      );
    if (event.status !== "published")
      throw new DomainError(
        "EVENT_CLOSED",
        "This event has been canceled.",
        409,
      );
    if (data.revision !== undefined && data.revision !== event.revision)
      throw new DomainError(
        "VERSION_CONFLICT",
        "This event changed. Refresh and try again.",
        409,
      );
    const startsAt = data.startsAt ?? event.starts_at,
      endsAt = data.endsAt ?? event.ends_at;
    if (
      new Date(startsAt).getTime() <= Date.now() ||
      new Date(endsAt) <= new Date(startsAt)
    )
      throw new DomainError(
        "VALIDATION_ERROR",
        "Choose a future start time and an end time after it.",
        422,
      );
    const capacity =
      event.source === "native"
        ? data.capacity === undefined
          ? event.capacity
          : data.capacity
        : null;
    const [count] =
      await tx`SELECT count(*) going FROM event_rsvps WHERE event_id=${data.eventId} AND status='going'`;
    if (capacity !== null && capacity < Number(count.going))
      throw new DomainError(
        "VALIDATION_ERROR",
        "Capacity cannot be lower than your confirmed guest count.",
        422,
      );
    await tx`UPDATE events SET title=${data.title ?? event.title},description=${data.description ?? event.description},starts_at=${startsAt},ends_at=${endsAt},
      venue=${data.venue ?? event.venue},exact_address=${data.exactAddress === undefined ? event.exact_address : data.exactAddress},capacity=${capacity},revision=revision+1,updated_at=now() WHERE id=${data.eventId}`;
    const guests =
      await tx`SELECT user_id FROM event_rsvps WHERE event_id=${data.eventId} AND status IN ('going','waitlisted','pending_approval')`;
    for (const guest of guests)
      await tx`INSERT INTO notifications(id,user_id,type,message,resource_id,dedupe_key) VALUES(${randomUUID()},${guest.user_id},'event',
      'The host updated your event details. Check the event for the latest information.',${data.eventId},${`edit:${data.eventId}:${Number(event.revision) + 1}:${guest.user_id}`}) ON CONFLICT DO NOTHING`;
  });
  return { event: (await getEvents(member.id, data.eventId))[0] };
}

export async function closeEventRegistration(member: Member, eventId: string) {
  requireEligible(member);
  const [event] =
    await sql`UPDATE events SET registration_closed=true,updated_at=now() WHERE id=${eventId} AND host_id=${member.id} RETURNING id`;
  if (!event)
    throw new DomainError(
      "FORBIDDEN",
      "Only the host can close registration.",
      403,
    );
  return { closed: true };
}
