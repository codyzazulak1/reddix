"use client";

import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Bookmark,
  CalendarDays,
  CalendarRange,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Flag,
  List,
  Loader2,
  LockKeyhole,
  MapPin,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import type {
  Community,
  Member,
  PublicMember,
  ReddixEvent,
} from "../../lib/types";
import EventArtwork from "./EventArtwork";
import { zonedDateTime } from "./date-utils";
import "./events.css";

export type EventsViewProps = {
  events: ReddixEvent[];
  currentUser: Member;
  communities: Community[];
  onAction: (
    action: string,
    payload?: Record<string, unknown>,
  ) => Promise<unknown>;
  onNavigate: (path: string) => void;
  selectedEventId?: string;
};
type View = "agenda" | "week" | "month";
type Guest = { member: PublicMember; status: string; createdAt: string };
const cities = [
  "San Francisco",
  "New York",
  "Toronto",
  "Seattle",
  "Los Angeles",
  "Online",
];
const zones: Record<string, string> = {
  "San Francisco": "America/Los_Angeles",
  "New York": "America/New_York",
  Toronto: "America/Toronto",
  Seattle: "America/Los_Angeles",
  "Los Angeles": "America/Los_Angeles",
  Online: "UTC",
};
const cityIds: Record<string, string> = {
  "San Francisco": "sf",
  "New York": "new-york",
  Toronto: "toronto",
  Seattle: "seattle",
  "Los Angeles": "la",
  Online: "online",
};
const cityLabel = (value: string) =>
  Object.entries(cityIds).find(([, id]) => id === value)?.[0] || value;
const dateKey = (date: Date | string, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(date));
const formatDate = (
  value: string | Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
) =>
  new Intl.DateTimeFormat("en-US", { timeZone, ...options }).format(
    new Date(value),
  );
const timeLabel = (event: ReddixEvent) =>
  formatDate(event.startsAt, event.timezone, {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
const localDay = (key: string) => new Date(`${key}T12:00:00`);
const plainDate = (value: Date) =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
const shiftDay = (value: string, days: number) => {
  const date = localDay(value);
  date.setDate(date.getDate() + days);
  return plainDate(date);
};
const artworkVariant = (event: ReddixEvent) =>
  [...(event.coverStyle || event.id)].reduce(
    (sum, char) => sum + char.charCodeAt(0),
    0,
  ) % 4;
const rsvpLabel: Record<string, string> = {
  going: "You're going",
  pending_approval: "Awaiting approval",
  waitlisted: "You're on the waitlist",
  interested: "Interested",
  declined: "Request declined",
  canceled: "Registration withdrawn",
  none: "",
};
const eventPeriods = [
  ["upcoming", "Upcoming"],
  ["today", "Today"],
  ["week", "This week"],
  ["weekend", "Weekend"],
  ["mine", "My events"],
] as const;

function Avatar({
  member,
  small = false,
}: {
  member: PublicMember;
  small?: boolean;
}) {
  return (
    <span
      className={`ev-avatar${small ? " ev-avatar-small" : ""}`}
      aria-hidden="true"
    >
      {member.avatarUrl ? (
        <img src={member.avatarUrl} alt="" />
      ) : (
        member.name
          .split(" ")
          .map((part) => part[0])
          .slice(0, 2)
          .join("")
      )}
    </span>
  );
}

export default function EventsView({
  events,
  currentUser,
  communities,
  onAction,
  onNavigate,
  selectedEventId,
}: EventsViewProps) {
  const [view, setView] = useState<View>("agenda");
  const [city, setCity] = useState("All cities");
  const [source, setSource] = useState("all");
  const [topic, setTopic] = useState("all");
  const [period, setPeriod] = useState("upcoming");
  const [search, setSearch] = useState("");
  const [community, setCommunity] = useState("all");
  const [eventFormat, setEventFormat] = useState("all");
  const [moreFilters, setMoreFilters] = useState(false);
  const [filtersReady, setFiltersReady] = useState(false);
  const [creating, setCreating] = useState(false);
  const timeZone =
    zones[city] ||
    zones[cityLabel(currentUser.preferences.city)] ||
    Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = dateKey(new Date(), timeZone);
  const [calendarDate, setCalendarDate] = useState(today);
  const selected = events.find((event) => event.id === selectedEventId);
  const topics = Array.from(
    new Set(events.flatMap((event) => event.tags)),
  ).sort();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("city")) setCity(cityLabel(params.get("city")!));
    if (["native", "external"].includes(params.get("source") || "")) {
      setSource(params.get("source")!);
      setMoreFilters(true);
    }
    if (params.get("topic")) setTopic(params.get("topic")!);
    if (["today", "week", "weekend", "mine"].includes(params.get("when") || ""))
      setPeriod(params.get("when")!);
    if (["agenda", "week", "month"].includes(params.get("view") || ""))
      setView(params.get("view") as View);
    if (params.get("q")) setSearch(params.get("q")!);
    if (/^\d{4}-\d{2}-\d{2}$/.test(params.get("date") || ""))
      setCalendarDate(params.get("date")!);
    if (params.get("community")) {
      setCommunity(params.get("community")!);
      setMoreFilters(true);
    }
    if (["in_person", "online"].includes(params.get("format") || "")) {
      setEventFormat(params.get("format")!);
      setMoreFilters(true);
    }
    setFiltersReady(true);
  }, []);
  useEffect(() => {
    if (!filtersReady || selectedEventId) return;
    const params = new URLSearchParams();
    if (city !== "All cities") params.set("city", city);
    if (source !== "all") params.set("source", source);
    if (topic !== "all") params.set("topic", topic);
    if (period !== "upcoming") params.set("when", period);
    if (view !== "agenda") params.set("view", view);
    if (search) params.set("q", search);
    if (community !== "all") params.set("community", community);
    if (eventFormat !== "all") params.set("format", eventFormat);
    if (calendarDate !== today && view !== "agenda")
      params.set("date", calendarDate);
    const query = params.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}`,
    );
  }, [
    filtersReady,
    selectedEventId,
    city,
    source,
    topic,
    period,
    view,
    search,
    community,
    eventFormat,
    calendarDate,
    today,
  ]);
  const filtered = useMemo(() => {
    const weekStart = shiftDay(today, -(localDay(today).getDay() + 6) % 7);
    const weekEnd = shiftDay(weekStart, 6);
    return events
      .filter((event) => {
        const start = dateKey(event.startsAt, timeZone);
        const end = dateKey(event.endsAt, timeZone);
        const mine =
          event.host.id === currentUser.id ||
          ["going", "pending_approval", "waitlisted", "interested"].includes(
            event.myRsvp,
          ) ||
          event.isSaved;
        const matchesPeriod =
          period === "mine"
            ? mine
            : period === "today"
              ? start <= today && end >= today
              : period === "week"
                ? start <= weekEnd && end >= weekStart
                : period === "weekend"
                  ? start <= weekEnd && end >= shiftDay(weekStart, 5)
                  : new Date(event.endsAt) >= new Date();
        return (
          (event.visibility === "listed" || mine) &&
          matchesPeriod &&
          (city === "All cities" ||
            cityLabel(event.city) === city ||
            (city === "Online" && event.format === "online")) &&
          (source === "all" || event.source === source) &&
          (topic === "all" || event.tags.includes(topic)) &&
          (community === "all" || event.communityId === community) &&
          (eventFormat === "all" || event.format === eventFormat) &&
          `${event.title} ${event.description} ${event.host.name} ${event.venue}`
            .toLowerCase()
            .includes(search.toLowerCase())
        );
      })
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }, [
    events,
    city,
    source,
    topic,
    period,
    search,
    community,
    eventFormat,
    today,
    timeZone,
    currentUser.id,
  ]);
  const groups = filtered.reduce<Record<string, ReddixEvent[]>>(
    (result, event) => {
      const key = dateKey(event.startsAt, timeZone);
      (result[key] ||= []).push(event);
      return result;
    },
    {},
  );
  const openEvent = (event: ReddixEvent) => onNavigate(`/e/${event.id}`);

  if (selected)
    return (
      <div className="ev-root">
        <EventDetail
          key={selected.id}
          event={selected}
          currentUser={currentUser}
          onAction={onAction}
          onBack={() => onNavigate("/events")}
        />
      </div>
    );
  if (selectedEventId && !selected)
    return (
      <div className="ev-root ev-empty">
        <LockKeyhole size={32} />
        <h2>This event is not available.</h2>
        <p>
          It may be private, removed, or require an invitation from the host.
        </p>
        <button
          className="ev-button ev-button-primary"
          onClick={() => onNavigate("/events")}
        >
          Explore events
        </button>
      </div>
    );

  return (
    <section className="ev-root">
      <div className="ev-page-heading">
        <div>
          <h1>Events</h1>
          <p>Find tech gatherings in your city.</p>
        </div>
        <button
          className="ev-button ev-button-primary"
          onClick={() => setCreating(true)}
        >
          <Plus size={16} /> Create event
        </button>
      </div>
      <div className="ev-toolbar">
        <select
          className="ev-period-select"
          aria-label="Event timeframe"
          value={period}
          onChange={(change) => setPeriod(change.target.value)}
        >
          {eventPeriods.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <div className="ev-shortcuts">
          {eventPeriods.map(([value, label]) => (
            <button
              key={value}
              className={period === value ? "active" : ""}
              onClick={() => setPeriod(value)}
              aria-pressed={period === value}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="ev-view-switch" aria-label="Calendar layout">
          {(
            [
              { id: "agenda", Icon: List },
              { id: "week", Icon: CalendarRange },
              { id: "month", Icon: CalendarDays },
            ] as const
          ).map(({ id, Icon }) => (
            <button
              key={id}
              className={view === id ? "active" : ""}
              onClick={() => setView(id)}
              aria-label={`${id} view`}
              aria-pressed={view === id}
              title={`${id[0].toUpperCase()}${id.slice(1)} view`}
            >
              <Icon size={16} />
            </button>
          ))}
        </div>
      </div>
      <div className="ev-filters">
        <label className="ev-select-wrap">
          <select
            value={city}
            onChange={(event) => setCity(event.target.value)}
            aria-label="Filter by city"
          >
            <option>All cities</option>
            {Array.from(
              new Set([
                ...cities,
                ...events.map((event) => cityLabel(event.city)),
              ]),
            ).map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label className="ev-select-wrap">
          <select
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            aria-label="Filter by topic"
          >
            <option value="all">All interests</option>
            {topics.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <button
          className={`ev-icon-button ev-more-filters${moreFilters || source !== "all" || community !== "all" || eventFormat !== "all" ? " active" : ""}`}
          onClick={() => setMoreFilters(!moreFilters)}
          aria-label="Additional event filters"
          aria-expanded={moreFilters}
          title="Additional filters"
        >
          <Settings2 size={14} />
        </button>
        <label className="ev-search">
          <Search size={15} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Find an event"
            aria-label="Search events"
          />
        </label>
      </div>
      {moreFilters && (
        <div className="ev-filters ev-extra-filters">
          <label className="ev-select-wrap">
            <select
              value={source}
              onChange={(event) => setSource(event.target.value)}
              aria-label="Filter event source"
            >
              <option value="all">All events</option>
              <option value="native">On Reddix</option>
              <option value="external">External events</option>
            </select>
          </label>
          <label className="ev-select-wrap">
            <select
              value={community}
              onChange={(change) => setCommunity(change.target.value)}
              aria-label="Filter by community"
            >
              <option value="all">All communities</option>
              {communities.map((value) => (
                <option key={value.id} value={value.id}>
                  r/{value.slug}
                </option>
              ))}
            </select>
          </label>
          <label className="ev-select-wrap">
            <select
              value={eventFormat}
              onChange={(change) => setEventFormat(change.target.value)}
              aria-label="Filter event format"
            >
              <option value="all">Any format</option>
              <option value="in_person">In person</option>
              <option value="online">Online</option>
            </select>
          </label>
        </div>
      )}
      <div className="ev-results-label">
        <span>
          {filtered.length} {filtered.length === 1 ? "event" : "events"}
        </span>
        <span>{timeZone.replaceAll("_", " ")}</span>
      </div>
      {view === "agenda" ? (
        filtered.length ? (
          <div className="ev-agenda">
            {Object.entries(groups).map(([day, dayEvents]) => (
              <div className="ev-day-group" key={day}>
                <div className="ev-day-label">
                  <strong>
                    {formatDate(`${day}T12:00:00Z`, "UTC", {
                      month: "short",
                      day: "numeric",
                    })}
                  </strong>
                  <span>
                    {day === today
                      ? "Today"
                      : formatDate(`${day}T12:00:00Z`, "UTC", {
                          weekday: "long",
                        })}
                  </span>
                </div>
                <div className="ev-day-events">
                  {dayEvents.map((event) => (
                    <EventCard
                      key={event.id}
                      event={event}
                      onOpen={() => openEvent(event)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="ev-empty">
            <CalendarDays size={30} />
            <h3>A little room in the calendar.</h3>
            <p>
              No events match these filters. Try another city or make something
              happen.
            </p>
            <button
              className="ev-button"
              onClick={() => {
                setCity("All cities");
                setTopic("all");
                setSource("all");
                setPeriod("upcoming");
                setSearch("");
                setCommunity("all");
                setEventFormat("all");
              }}
            >
              Reset filters
            </button>
          </div>
        )
      ) : (
        <CalendarView
          events={filtered}
          view={view}
          date={calendarDate}
          onDate={setCalendarDate}
          timeZone={timeZone}
          today={today}
          onOpen={openEvent}
        />
      )}
      <CreateEventDialog
        open={creating}
        onOpenChange={setCreating}
        currentUser={currentUser}
        communities={communities}
        onAction={onAction}
      />
    </section>
  );
}

function EventCard({
  event,
  onOpen,
}: {
  event: ReddixEvent;
  onOpen: () => void;
}) {
  return (
    <button
      className={`ev-card${event.status === "canceled" ? " ev-card-canceled" : ""}`}
      onClick={onOpen}
    >
      <div className="ev-card-copy">
        <div className="ev-card-time">
          {timeLabel(event)}
          {event.myRsvp === "going" && (
            <span className="ev-going-tag">Going</span>
          )}
        </div>
        <h3>{event.title}</h3>
        <div className="ev-location">
          {event.format === "online"
            ? "Online"
            : `${event.venue || cityLabel(event.city)}${event.venue && event.venue !== event.city ? ` · ${cityLabel(event.city)}` : ""}`}
        </div>
        <div className="ev-card-bottom">
          {event.source === "external" && (
            <span className="ev-source-tag">
              {event.sourceLabel || "External"}
            </span>
          )}
          {event.status === "canceled" ? (
            <span className="ev-canceled-tag">Canceled</span>
          ) : event.requiresApproval ? (
            <span className="ev-subtle-tag">Approval required</span>
          ) : null}
          {event.goingCount + event.interestedCount > 0 && (
            <span className="ev-attendance">
              {event.source === "native"
                ? `${event.goingCount} going`
                : `${event.interestedCount + event.goingCount} interested on Reddix`}
            </span>
          )}
        </div>
      </div>
      <EventArtwork
        variant={artworkVariant(event)}
        title={event.title}
        city={cityLabel(event.city)}
        date={formatDate(event.startsAt, event.timezone, {
          month: "short",
          day: "numeric",
        })}
      />
    </button>
  );
}

function CalendarView({
  events,
  view,
  date,
  onDate,
  timeZone,
  today,
  onOpen,
}: {
  events: ReddixEvent[];
  view: "week" | "month";
  date: string;
  onDate: (date: string) => void;
  timeZone: string;
  today: string;
  onOpen: (event: ReddixEvent) => void;
}) {
  const active = localDay(date);
  const first =
    view === "month"
      ? new Date(active.getFullYear(), active.getMonth(), 1, 12)
      : active;
  const start = shiftDay(plainDate(first), -(first.getDay() + 6) % 7);
  const days = Array.from({ length: view === "week" ? 7 : 42 }, (_, index) =>
    shiftDay(start, index),
  );
  function move(direction: number) {
    const next = localDay(date);
    if (view === "month") next.setMonth(next.getMonth() + direction, 1);
    else next.setDate(next.getDate() + direction * 7);
    onDate(plainDate(next));
  }
  return (
    <div className="ev-calendar">
      <div className="ev-calendar-heading">
        <h3>
          {active.toLocaleDateString("en-US", {
            month: "long",
            year: "numeric",
          })}
        </h3>
        <div>
          <button
            className="ev-icon-button"
            aria-label={`Previous ${view}`}
            onClick={() => move(-1)}
          >
            <ChevronLeft size={17} />
          </button>
          <button
            className="ev-button ev-button-small"
            onClick={() => onDate(today)}
          >
            Today
          </button>
          <button
            className="ev-icon-button"
            aria-label={`Next ${view}`}
            onClick={() => move(1)}
          >
            <ChevronRight size={17} />
          </button>
        </div>
      </div>
      <div
        className={`ev-calendar-grid ev-calendar-${view}`}
        role="grid"
        aria-label={`${view} calendar`}
      >
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
          <div className="ev-calendar-weekday" key={day} role="columnheader">
            {day}
          </div>
        ))}
        {days.map((day) => {
          const dayEvents = events.filter(
            (event) =>
              dateKey(event.startsAt, timeZone) <= day &&
              dateKey(event.endsAt, timeZone) >= day,
          );
          return (
            <div
              role="gridcell"
              className={`ev-calendar-day${day === today ? " ev-is-today" : ""}${localDay(day).getMonth() !== active.getMonth() && view === "month" ? " ev-other-month" : ""}`}
              key={day}
            >
              <span className="ev-day-number">{localDay(day).getDate()}</span>
              {dayEvents.map((event) => (
                <button
                  className={`ev-calendar-event ev-calendar-tone-${artworkVariant(event)}`}
                  key={event.id}
                  onClick={() => onOpen(event)}
                >
                  <span>
                    {formatDate(event.startsAt, timeZone, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                  <strong>{event.title}</strong>
                  {view === "week" && (
                    <small>
                      <MapPin size={10} />
                      {cityLabel(event.city)}
                    </small>
                  )}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EventDetail({
  event,
  currentUser,
  onAction,
  onBack,
}: {
  event: ReddixEvent;
  currentUser: Member;
  onAction: EventsViewProps["onAction"];
  onBack: () => void;
}) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [publicAttendance, setPublicAttendance] = useState(
    currentUser.preferences.publicAttendance,
  );
  const [managing, setManaging] = useState(false);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [guestsLoading, setGuestsLoading] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [editing, setEditing] = useState(false);
  const [updates, setUpdates] = useState<
    { id: string; body: string; createdAt: string }[]
  >([]);
  const [reporting, setReporting] = useState(false);
  const [reportReason, setReportReason] = useState("Unsafe event");
  const isHost = event.host.id === currentUser.id;
  const activeRsvp = [
    "going",
    "pending_approval",
    "waitlisted",
    "interested",
  ].includes(event.myRsvp);
  const registrationClosed = Boolean(
    (event as ReddixEvent & { registrationClosed?: boolean })
      .registrationClosed,
  );
  const closed =
    registrationClosed ||
    event.status === "canceled" ||
    new Date(event.startsAt) <= new Date();
  const full = event.capacity !== null && event.goingCount >= event.capacity;

  async function run(
    action: string,
    payload: Record<string, unknown>,
    message?: string,
  ) {
    setBusy(action);
    setError("");
    setNotice("");
    try {
      await onAction(action, { eventId: event.id, ...payload });
      if (message) setNotice(message);
      return true;
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.",
      );
      return false;
    } finally {
      setBusy("");
    }
  }
  async function loadGuests() {
    setGuestsLoading(true);
    try {
      const response = await fetch(`/api/events/${event.id}/guests`, {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error?.message || "Could not load guests.");
      setGuests(data.guests || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load guests.");
    } finally {
      setGuestsLoading(false);
    }
  }
  async function loadUpdates() {
    try {
      const response = await fetch(`/api/events/${event.id}`, {
        cache: "no-store",
      });
      if (response.ok) {
        const data = await response.json();
        setUpdates(data.updates || []);
      }
    } catch {
      /* Discovery data is still usable if announcement loading fails. */
    }
  }
  useEffect(() => {
    if (managing && isHost) void loadGuests();
  }, [managing, isHost, event.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    void loadUpdates();
  }, [event.id, event.revision]); // eslint-disable-line react-hooks/exhaustive-deps

  async function share() {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/e/${event.id}`,
      );
      setNotice(
        "Event link copied. Recipients will need to sign in to view it.",
      );
    } catch {
      setNotice(`Share this link: ${window.location.origin}/e/${event.id}`);
    }
  }
  return (
    <>
      <button className="ev-back" onClick={onBack}>
        <ArrowLeft size={16} /> All events
      </button>
      <div className="ev-detail-layout">
        <aside className="ev-detail-aside">
          <EventArtwork
            variant={artworkVariant(event)}
            title={event.title}
            city={cityLabel(event.city)}
            date={formatDate(event.startsAt, event.timezone, {
              month: "short",
              day: "numeric",
            })}
            large
          />
          <div className="ev-detail-host">
            <span className="ev-eyebrow">HOSTED BY</span>
            <div>
              <Avatar member={event.host} />
              <span>
                <strong>
                  {event.host.name}{" "}
                  {["blue", "business"].includes(
                    event.host.verificationType,
                  ) && <BadgeCheck size={14} />}
                </strong>
                <a
                  href={`https://x.com/${event.host.handle.replace("@", "")}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  @{event.host.handle.replace("@", "")}{" "}
                  <ExternalLink size={11} />
                </a>
              </span>
            </div>
          </div>
          <div className="ev-detail-share">
            <button className="ev-button" onClick={share}>
              <Copy size={14} /> Share event
            </button>
            <button
              className={`ev-icon-button${event.isSaved ? " active" : ""}`}
              disabled={!!busy}
              onClick={() =>
                void run(
                  "saveEvent",
                  { saved: !event.isSaved },
                  event.isSaved ? "Event removed from saved." : "Event saved.",
                )
              }
              aria-label={event.isSaved ? "Unsave event" : "Save event"}
            >
              <Bookmark
                size={17}
                fill={event.isSaved ? "currentColor" : "none"}
              />
            </button>
          </div>
          <p className="ev-share-note">
            <LockKeyhole size={12} /> Shared event links are visible to
            signed-in Reddix members only.
          </p>
        </aside>
        <div className="ev-detail-content">
          <div className="ev-detail-tags">
            <span className="ev-source-tag">
              {event.source === "native"
                ? "Hosted on Reddix"
                : `Via ${event.sourceLabel || "external event"}`}
            </span>
            {event.visibility !== "listed" && (
              <span className="ev-subtle-tag">
                <LockKeyhole size={11} /> {event.visibility}
              </span>
            )}
            {event.status === "canceled" && (
              <span className="ev-canceled-tag">Canceled</span>
            )}
          </div>
          <h1>{event.title}</h1>
          <div className="ev-detail-facts">
            <div>
              <span className="ev-fact-icon">
                <CalendarDays size={20} />
              </span>
              <span>
                <strong>
                  {formatDate(event.startsAt, event.timezone, {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })}
                </strong>
                <small>
                  {timeLabel(event)} to{" "}
                  {formatDate(event.endsAt, event.timezone, {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </small>
              </span>
            </div>
            <div>
              <span className="ev-fact-icon">
                <MapPin size={20} />
              </span>
              <span>
                <strong>
                  {event.format === "online"
                    ? "Online gathering"
                    : event.venue || cityLabel(event.city)}
                </strong>
                <small>
                  {event.exactAddress ||
                    (event.venueDisclosure === "attendees"
                      ? "Exact location shared with confirmed guests"
                      : event.venueDisclosure === "later"
                        ? "Exact location will be shared by the host"
                        : cityLabel(event.city))}
                </small>
              </span>
            </div>
          </div>
          <div className="ev-registration">
            <div className="ev-registration-heading">
              <h3>
                {event.status === "canceled"
                  ? "This gathering was canceled"
                  : closed
                    ? "Registration is closed"
                    : activeRsvp
                      ? rsvpLabel[event.myRsvp]
                      : event.source === "external"
                        ? "Make a plan to be there"
                        : "Save your spot"}
              </h3>
              {event.source === "native" && (
                <span>
                  <Users size={13} /> {event.goingCount}
                  {event.capacity ? ` / ${event.capacity}` : ""} going
                </span>
              )}
            </div>
            {event.status === "canceled" ? (
              <p>
                The host canceled this event. New registrations are unavailable.
              </p>
            ) : event.source === "external" ? (
              <>
                <p>
                  RSVP with the organizer. Interest shown here is self-reported
                  by Reddix members.
                </p>
                <a
                  className="ev-button ev-button-primary ev-button-full"
                  href={event.externalUrl || undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  RSVP on {event.sourceLabel || "event website"}{" "}
                  <ExternalLink size={15} />
                </a>
                {!closed && (
                  <button
                    className="ev-button ev-button-full"
                    disabled={!!busy || (!currentUser.eligible && !activeRsvp)}
                    onClick={() =>
                      void run(
                        "rsvp",
                        {
                          state: activeRsvp ? "canceled" : "interested",
                          publicAttendance,
                        },
                        activeRsvp
                          ? "Interest removed."
                          : "Interest saved on Reddix. Remember to RSVP with the organizer.",
                      )
                    }
                  >
                    <Check size={15} />
                    {activeRsvp
                      ? "Remove my interest"
                      : "I'm interested on Reddix"}
                  </button>
                )}
              </>
            ) : (
              <>
                <p>
                  {activeRsvp
                    ? event.myRsvp === "pending_approval"
                      ? "Your request is with the host. You will receive a notification when they respond."
                      : event.myRsvp === "waitlisted"
                        ? "We will let you know when a spot opens up. Your place is kept in order of registration."
                        : "You are on the list. Event updates will appear in your notifications."
                    : event.requiresApproval
                      ? "This gathering requires host approval. Request an invitation to join the conversation."
                      : full
                        ? event.waitlistEnabled
                          ? "All spots are taken. Join the waitlist and we will notify you if one opens."
                          : "All spots are taken for this gathering."
                        : "Reserve your place below."}
                </p>
                {!activeRsvp && !closed && (
                  <label className="ev-checkbox">
                    <input
                      type="checkbox"
                      checked={publicAttendance}
                      onChange={(change) =>
                        setPublicAttendance(change.target.checked)
                      }
                    />{" "}
                    Let other members see that I am attending
                  </label>
                )}
                {activeRsvp ? (
                  <button
                    className="ev-button ev-button-full"
                    disabled={!!busy}
                    onClick={() =>
                      void run(
                        "rsvp",
                        { state: "canceled" },
                        "Your registration has been withdrawn.",
                      )
                    }
                  >
                    {busy === "rsvp" && (
                      <Loader2 size={14} className="ev-spin" />
                    )}{" "}
                    Withdraw{" "}
                    {event.myRsvp === "pending_approval"
                      ? "request"
                      : "registration"}
                  </button>
                ) : (
                  !closed && (
                    <button
                      className="ev-button ev-button-primary ev-button-full"
                      disabled={
                        !!busy ||
                        !currentUser.eligible ||
                        (full && !event.waitlistEnabled)
                      }
                      onClick={() =>
                        void run(
                          "rsvp",
                          { state: "going", publicAttendance },
                          "Registration updated.",
                        )
                      }
                    >
                      <span>
                        {busy === "rsvp"
                          ? "Saving..."
                          : !currentUser.eligible
                            ? "X verification required to RSVP"
                            : event.requiresApproval
                              ? "Request to join"
                              : full
                                ? "Join waitlist"
                                : "Register for event"}
                      </span>
                      <ArrowRight size={15} />
                    </button>
                  )
                )}
                <div className="ev-privacy-note">
                  <ShieldCheck size={12} /> The host can see your registration.
                  Attendance is private by default.
                </div>
              </>
            )}
            {event.myRsvp === "going" && (
              <a
                className="ev-calendar-download"
                href={`/api/events/${event.id}/calendar`}
              >
                <ArrowDownToLine size={13} /> Add to your calendar (.ics)
              </a>
            )}
          </div>
          {error && (
            <div className="ev-alert ev-error" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="ev-alert" role="status">
              {notice}
            </div>
          )}
          <section className="ev-about">
            <h3>About this event</h3>
            <div>
              {event.description
                .split("\n")
                .map((paragraph, index) =>
                  paragraph ? (
                    <p key={index}>{paragraph}</p>
                  ) : (
                    <br key={index} />
                  ),
                )}
            </div>
            <div className="ev-topic-tags">
              {event.tags.map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
          </section>
          {updates.length > 0 && (
            <section className="ev-about ev-updates">
              <h3>Updates from the host</h3>
              {updates.map((update) => (
                <article key={update.id}>
                  <time dateTime={update.createdAt}>
                    {formatDate(update.createdAt, event.timezone, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </time>
                  <p>{update.body}</p>
                </article>
              ))}
            </section>
          )}
          {isHost && (
            <section className="ev-host-tools">
              <button
                className="ev-button ev-button-full"
                onClick={() => setManaging(!managing)}
              >
                <Settings2 size={15} />{" "}
                {managing ? "Close host tools" : "Manage event"}
                <ChevronRight size={15} />
              </button>
              {managing && (
                <div className="ev-management">
                  <div className="ev-management-actions">
                    <button
                      className="ev-button ev-button-small"
                      disabled={
                        !currentUser.eligible || event.status === "canceled"
                      }
                      onClick={() => setEditing(true)}
                    >
                      <Settings2 size={13} /> Edit event
                    </button>
                    {event.source === "native" && !closed && (
                      <button
                        className="ev-button ev-button-small"
                        disabled={!currentUser.eligible}
                        onClick={() => setConfirmClose(!confirmClose)}
                      >
                        Close registration
                      </button>
                    )}
                  </div>
                  {confirmClose && (
                    <div className="ev-close-confirm">
                      <p>
                        Close new registrations? Existing guests keep their
                        spots.
                      </p>
                      <button
                        className="ev-button ev-button-small"
                        disabled={!!busy}
                        onClick={async () => {
                          if (
                            await run(
                              "closeEventRegistration",
                              {},
                              "Registration is now closed.",
                            )
                          )
                            setConfirmClose(false);
                        }}
                      >
                        Confirm closure
                      </button>
                      <button
                        className="ev-text-button"
                        onClick={() => setConfirmClose(false)}
                      >
                        Keep open
                      </button>
                    </div>
                  )}
                  <h3>Guest management</h3>
                  {guestsLoading ? (
                    <p>Loading guest list...</p>
                  ) : guests.length ? (
                    <div className="ev-guests">
                      {guests.map((guest) => (
                        <div className="ev-guest" key={guest.member.id}>
                          <Avatar member={guest.member} small />
                          <div>
                            <strong>{guest.member.name}</strong>
                            <span>{guest.status.replaceAll("_", " ")}</span>
                          </div>
                          {guest.status === "pending_approval" && (
                            <div className="ev-guest-actions">
                              <button
                                className="ev-icon-button"
                                title="Approve guest"
                                aria-label={`Approve ${guest.member.name}`}
                                disabled={
                                  !!busy || !currentUser.eligible || closed
                                }
                                onClick={async () => {
                                  if (
                                    await run("reviewRsvp", {
                                      memberId: guest.member.id,
                                      decision: "approved",
                                    })
                                  )
                                    await loadGuests();
                                }}
                              >
                                <Check size={15} />
                              </button>
                              <button
                                className="ev-icon-button"
                                title="Decline guest"
                                aria-label={`Decline ${guest.member.name}`}
                                disabled={
                                  !!busy || !currentUser.eligible || closed
                                }
                                onClick={async () => {
                                  if (
                                    await run("reviewRsvp", {
                                      memberId: guest.member.id,
                                      decision: "declined",
                                    })
                                  )
                                    await loadGuests();
                                }}
                              >
                                <X size={15} />
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p>
                      No registrations yet. Share your event to get the
                      conversation started.
                    </p>
                  )}
                  <form
                    onSubmit={async (submit) => {
                      submit.preventDefault();
                      if (
                        await run(
                          "eventUpdate",
                          { body: announcement },
                          "Update published to your event guests.",
                        )
                      ) {
                        setAnnouncement("");
                        await loadUpdates();
                      }
                    }}
                  >
                    <label className="ev-field">
                      Post an update
                      <textarea
                        value={announcement}
                        onChange={(change) =>
                          setAnnouncement(change.target.value)
                        }
                        placeholder="Something your guests should know..."
                        required
                        maxLength={2000}
                        rows={3}
                      />
                    </label>
                    <button
                      className="ev-button"
                      disabled={
                        !!busy || !currentUser.eligible || !announcement.trim()
                      }
                    >
                      Send update to guests
                    </button>
                  </form>
                  {event.status !== "canceled" && (
                    <div className="ev-cancel-area">
                      {confirmCancel ? (
                        <>
                          <p>
                            Cancel this event? Guests will be notified and
                            registration will close.
                          </p>
                          <div>
                            <button
                              className="ev-button ev-danger-button"
                              disabled={!!busy}
                              onClick={async () => {
                                if (
                                  await run(
                                    "cancelEvent",
                                    {},
                                    "Event canceled. Guests will receive a notification.",
                                  )
                                )
                                  setConfirmCancel(false);
                              }}
                            >
                              Confirm cancellation
                            </button>
                            <button
                              className="ev-button"
                              onClick={() => setConfirmCancel(false)}
                            >
                              Keep event
                            </button>
                          </div>
                        </>
                      ) : (
                        <button
                          className="ev-text-button ev-danger"
                          onClick={() => setConfirmCancel(true)}
                        >
                          Cancel this event
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
          <button
            className="ev-report-button"
            onClick={() => setReporting(true)}
          >
            <Flag size={12} /> Report this event
          </button>
          <p className="ev-detail-footnote">
            Calendar downloads are a snapshot and do not automatically update.
            Re-download after event changes.
            {event.exactAddress && event.venueDisclosure === "attendees"
              ? " Your calendar file may contain the private venue address."
              : ""}
          </p>
        </div>
      </div>
      <EditEventDialog
        key={event.revision}
        event={event}
        open={editing}
        onOpenChange={setEditing}
        onAction={onAction}
      />
      <Dialog.Root open={reporting} onOpenChange={setReporting}>
        <Dialog.Portal>
          <Dialog.Overlay className="ev-dialog-overlay" />
          <Dialog.Content className="ev-dialog ev-report-dialog">
            <div className="ev-dialog-heading">
              <div>
                <Dialog.Title>Report this event</Dialog.Title>
                <Dialog.Description>
                  Your report is sent privately to Reddix admins.
                </Dialog.Description>
              </div>
              <Dialog.Close
                className="ev-icon-button"
                aria-label="Close report"
              >
                <X size={18} />
              </Dialog.Close>
            </div>
            <form
              onSubmit={async (submit) => {
                submit.preventDefault();
                if (
                  await run(
                    "report",
                    {
                      targetType: "event",
                      targetId: event.id,
                      reason: reportReason,
                    },
                    "Report received. Thank you for looking out for the community.",
                  )
                )
                  setReporting(false);
              }}
            >
              <label className="ev-field">
                Reason
                <select
                  value={reportReason}
                  onChange={(change) => setReportReason(change.target.value)}
                >
                  {[
                    "Unsafe event",
                    "Scam or misleading event",
                    "Spam",
                    "Privacy violation",
                    "Impersonation",
                    "Off-topic",
                    "Other",
                  ].map((reason) => (
                    <option key={reason}>{reason}</option>
                  ))}
                </select>
              </label>
              {error && (
                <div className="ev-alert ev-error" role="alert">
                  {error}
                </div>
              )}
              <button
                className="ev-button ev-button-primary ev-button-full"
                disabled={!!busy}
              >
                Send report
              </button>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

function EditEventDialog({
  event,
  open,
  onOpenChange,
  onAction,
}: {
  event: ReddixEvent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAction: EventsViewProps["onAction"];
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const wallTime = (instant: string) =>
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: event.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .format(new Date(instant))
      .replace(" ", "T");
  async function submit(submission: React.FormEvent<HTMLFormElement>) {
    submission.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(submission.currentTarget);
    try {
      const startsAt = zonedDateTime(
        String(form.get("startsAt")),
        event.timezone,
      );
      const endsAt = zonedDateTime(String(form.get("endsAt")), event.timezone);
      if (endsAt <= startsAt)
        throw new Error("The event must end after it begins.");
      const capacity = form.get("capacity")
        ? Number(form.get("capacity"))
        : null;
      if (capacity !== null && capacity < event.goingCount)
        throw new Error(
          "Capacity cannot be lower than the number of confirmed guests.",
        );
      await onAction("editEvent", {
        eventId: event.id,
        revision: event.revision,
        title: form.get("title"),
        description: form.get("description"),
        startsAt,
        endsAt,
        venue: form.get("venue"),
        exactAddress: form.get("exactAddress") || null,
        capacity: event.source === "native" ? capacity : null,
      });
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save these changes.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ev-dialog-overlay" />
        <Dialog.Content className="ev-dialog">
          <div className="ev-dialog-heading">
            <div>
              <Dialog.Title>Edit your event</Dialog.Title>
              <Dialog.Description>
                Schedule and location changes notify registered guests.
              </Dialog.Description>
            </div>
            <Dialog.Close
              className="ev-icon-button"
              aria-label="Close event editor"
            >
              <X size={18} />
            </Dialog.Close>
          </div>
          <form onSubmit={submit}>
            <label className="ev-field">
              Event name
              <input
                name="title"
                defaultValue={event.title}
                required
                maxLength={180}
              />
            </label>
            <label className="ev-field">
              About the gathering
              <textarea
                name="description"
                defaultValue={event.description}
                required
                minLength={10}
                rows={4}
                maxLength={10000}
              />
            </label>
            <div className="ev-form-row">
              <label className="ev-field">
                Starts
                <input
                  name="startsAt"
                  type="datetime-local"
                  defaultValue={wallTime(event.startsAt)}
                  required
                />
              </label>
              <label className="ev-field">
                Ends
                <input
                  name="endsAt"
                  type="datetime-local"
                  defaultValue={wallTime(event.endsAt)}
                  required
                />
              </label>
            </div>
            <p className="ev-form-hint">
              Times are in {event.timezone.replaceAll("_", " ")}.
            </p>
            <label className="ev-field">
              Venue or neighborhood
              <input name="venue" defaultValue={event.venue} required />
            </label>
            <label className="ev-field">
              {event.format === "online" ? "Meeting link" : "Exact address"}
              <input
                name="exactAddress"
                defaultValue={event.exactAddress || ""}
                type={event.format === "online" ? "url" : "text"}
              />
              <span className="ev-form-hint">
                Your existing location privacy settings still apply.
              </span>
            </label>
            {event.source === "native" && (
              <label className="ev-field">
                Guest capacity
                <input
                  name="capacity"
                  type="number"
                  min={Math.max(1, event.goingCount)}
                  defaultValue={event.capacity || ""}
                  placeholder="Unlimited"
                />
              </label>
            )}
            {error && (
              <div className="ev-alert ev-error" role="alert">
                {error}
              </div>
            )}
            <div className="ev-dialog-footer">
              <span>Existing registrations are preserved.</span>
              <button className="ev-button ev-button-primary" disabled={busy}>
                {busy ? (
                  <>
                    <Loader2 size={14} className="ev-spin" /> Saving...
                  </>
                ) : (
                  "Save changes"
                )}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function CreateEventDialog({
  open,
  onOpenChange,
  currentUser,
  communities,
  onAction,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUser: Member;
  communities: Community[];
  onAction: EventsViewProps["onAction"];
}) {
  const [source, setSource] = useState<"native" | "external">("native");
  const [city, setCity] = useState(
    zones[cityLabel(currentUser.preferences.city)]
      ? cityLabel(currentUser.preferences.city)
      : "San Francisco",
  );
  const [format, setFormat] = useState("in_person");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const timezone = String(form.get("timezone"));
      const startsAt = zonedDateTime(String(form.get("startsAt")), timezone);
      const endsAt = zonedDateTime(String(form.get("endsAt")), timezone);
      if (endsAt <= startsAt)
        throw new Error("The event must end after it begins.");
      if (new Date(startsAt) <= new Date())
        throw new Error("Choose a future date for your event.");
      if (
        source === "external" &&
        new URL(String(form.get("externalUrl"))).protocol !== "https:"
      )
        throw new Error("External event links must start with https://.");
      await onAction("createEvent", {
        title: form.get("title"),
        description: form.get("description"),
        source,
        city: cityIds[city] || city,
        timezone,
        startsAt,
        endsAt,
        format,
        venue: form.get("venue") || city,
        exactAddress: form.get("exactAddress") || undefined,
        venueDisclosure: form.get("venueDisclosure") || "attendees",
        visibility: form.get("visibility") || "listed",
        capacity:
          source === "native" && form.get("capacity")
            ? Number(form.get("capacity"))
            : null,
        requiresApproval: form.get("requiresApproval") === "on",
        waitlistEnabled: form.get("waitlistEnabled") === "on",
        communityId: form.get("communityId") || null,
        tags: String(form.get("tags") || "")
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean)
          .slice(0, 5),
        externalUrl:
          source === "external" ? form.get("externalUrl") : undefined,
        sourceLabel:
          source === "external" ? form.get("sourceLabel") : undefined,
        coverStyle: String(form.get("coverStyle") || "orbit"),
      });
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not create this event. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ev-dialog-overlay" />
        <Dialog.Content className="ev-dialog">
          <div className="ev-dialog-heading">
            <div>
              <Dialog.Title>Create a gathering</Dialog.Title>
              <Dialog.Description>
                Bring your corner of the tech community together.
              </Dialog.Description>
            </div>
            <Dialog.Close
              className="ev-icon-button"
              aria-label="Close create event"
            >
              <X size={20} />
            </Dialog.Close>
          </div>
          {!currentUser.eligible ? (
            <div className="ev-eligibility-message">
              <ShieldCheck size={32} />
              <h3>Good gatherings start with verified people.</h3>
              <p>
                A blue or gold X verification is required to create events. You
                can still explore the community calendar.
              </p>
              <Dialog.Close className="ev-button ev-button-primary">
                Keep exploring
              </Dialog.Close>
            </div>
          ) : (
            <form onSubmit={submit}>
              <div className="ev-create-tabs">
                <button
                  type="button"
                  className={source === "native" ? "active" : ""}
                  onClick={() => setSource("native")}
                >
                  <CalendarDays size={15} /> Host on Reddix
                </button>
                <button
                  type="button"
                  className={source === "external" ? "active" : ""}
                  onClick={() => setSource("external")}
                >
                  <ExternalLink size={15} /> Add external event
                </button>
              </div>
              <label className="ev-field">
                Event name
                <input
                  name="title"
                  placeholder="A name worth putting in the calendar"
                  required
                  maxLength={180}
                />
              </label>
              <label className="ev-field">
                About the gathering
                <textarea
                  name="description"
                  placeholder="Who is it for? What can people expect?"
                  required
                  minLength={10}
                  maxLength={10000}
                  rows={3}
                />
              </label>
              {source === "external" && (
                <div className="ev-form-row">
                  <label className="ev-field">
                    Event link
                    <input
                      name="externalUrl"
                      type="url"
                      placeholder="https://lu.ma/..."
                      required
                    />
                  </label>
                  <label className="ev-field">
                    Platform
                    <select name="sourceLabel">
                      <option>Luma</option>
                      <option>Partiful</option>
                      <option>Eventbrite</option>
                      <option>Organizer website</option>
                    </select>
                  </label>
                </div>
              )}
              <div className="ev-form-row">
                <label className="ev-field">
                  Starts
                  <input name="startsAt" type="datetime-local" required />
                </label>
                <label className="ev-field">
                  Ends
                  <input name="endsAt" type="datetime-local" required />
                </label>
              </div>
              <div className="ev-form-row">
                <label className="ev-field">
                  City
                  <select
                    name="city"
                    value={city}
                    onChange={(change) => setCity(change.target.value)}
                  >
                    {cities.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <label className="ev-field">
                  Timezone
                  <select name="timezone" key={city} defaultValue={zones[city]}>
                    {Array.from(new Set(Object.values(zones))).map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="ev-form-row">
                <label className="ev-field">
                  Format
                  <select
                    name="format"
                    value={format}
                    onChange={(change) => setFormat(change.target.value)}
                  >
                    <option value="in_person">In person</option>
                    <option value="online">Online</option>
                  </select>
                </label>
                <label className="ev-field">
                  {format === "online" ? "Platform" : "Venue or neighborhood"}
                  <input
                    name="venue"
                    placeholder={
                      format === "online"
                        ? "Zoom, Meet, etc."
                        : "e.g. Hayes Valley"
                    }
                  />
                </label>
              </div>
              {source === "native" && (
                <>
                  <div className="ev-form-row">
                    <label className="ev-field">
                      {format === "online" ? "Meeting link" : "Exact address"}
                      <input
                        name="exactAddress"
                        type={format === "online" ? "url" : "text"}
                        placeholder="Optional"
                      />
                    </label>
                    <label className="ev-field">
                      Show exact location to
                      <select name="venueDisclosure" defaultValue="attendees">
                        <option value="attendees">Confirmed guests only</option>
                        <option value="all">All allowed viewers</option>
                        <option value="later">Share with guests later</option>
                      </select>
                    </label>
                  </div>
                  <div className="ev-form-row">
                    <label className="ev-field">
                      Capacity
                      <input
                        name="capacity"
                        type="number"
                        min="1"
                        max="100000"
                        placeholder="Unlimited"
                      />
                    </label>
                    <label className="ev-field">
                      Discoverability
                      <select name="visibility" defaultValue="listed">
                        <option value="listed">Listed in the calendar</option>
                        <option value="unlisted">
                          Unlisted, accessible by link
                        </option>
                      </select>
                    </label>
                  </div>
                  <div className="ev-checkboxes">
                    <label className="ev-checkbox">
                      <input name="requiresApproval" type="checkbox" /> Require
                      host approval
                    </label>
                    <label className="ev-checkbox">
                      <input
                        name="waitlistEnabled"
                        type="checkbox"
                        defaultChecked
                      />{" "}
                      Enable waitlist when full
                    </label>
                  </div>
                </>
              )}
              <div className="ev-form-row">
                <label className="ev-field">
                  Community
                  <select name="communityId">
                    <option value="">General tech community</option>
                    {communities.map((community) => (
                      <option key={community.id} value={community.id}>
                        r/{community.slug}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ev-field">
                  Interests
                  <input name="tags" placeholder="Startups, AI, Engineering" />
                </label>
              </div>
              <label className="ev-field">
                Cover style
                <select name="coverStyle">
                  <option value="orbit">Orbit</option>
                  <option value="form">Form</option>
                  <option value="signal">Signal</option>
                  <option value="structure">Structure</option>
                </select>
              </label>
              {error && (
                <div className="ev-alert ev-error" role="alert">
                  {error}
                </div>
              )}
              <div className="ev-dialog-footer">
                <span>
                  <LockKeyhole size={12} /> Always private to signed-in members
                </span>
                <button className="ev-button ev-button-primary" disabled={busy}>
                  {busy ? (
                    <>
                      <Loader2 size={15} className="ev-spin" /> Publishing...
                    </>
                  ) : (
                    <>
                      Publish event <ArrowRight size={15} />
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
