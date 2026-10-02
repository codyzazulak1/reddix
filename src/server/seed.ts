import type { TransactionSql } from "postgres";
import { COMMUNITY_CATALOG } from "../lib/community-catalog";
import { sql } from "./db";

export async function seedCommunities(tx: TransactionSql) {
  for (const {
    slug,
    name,
    description,
    icon,
    color,
    city,
  } of COMMUNITY_CATALOG) {
    // Catalog growth is additive. Preserve moderator edits, archives, and existing memberships.
    await tx`INSERT INTO communities(id,slug,name,description,icon,color,city)
      VALUES(${slug},${slug},${name},${description},${icon},${color},${city}) ON CONFLICT DO NOTHING`;
  }
}

export async function seedDatabase() {
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(921873)`;
    await seedCommunities(tx);
    if (
      process.env.NODE_ENV === "production" ||
      process.env.AUTH_MODE !== "development"
    )
      return;
    const [seeded] =
      await tx`SELECT key FROM platform_settings WHERE key='demo_seed_v1'`;
    if (seeded) return;
    const people = [
      [
        "demo-alex",
        "Alex Chen",
        "alexbuilds",
        "blue",
        true,
        "Building useful things. Founder of a fictional startup. Demo profile.",
        "San Francisco, CA",
        12400,
      ],
      [
        "demo-morgan",
        "Morgan Studio",
        "morganstudio",
        "business",
        false,
        "An independent product studio for ambitious ideas. Fictional demo business.",
        "San Francisco, CA",
        8200,
      ],
      [
        "demo-jamie",
        "Jamie Park",
        "jamiecodes",
        "none",
        false,
        "Engineer, weekend cyclist, and very enthusiastic home cook. Fictional demo profile.",
        "Toronto, ON",
        380,
      ],
      [
        "demo-priya",
        "Priya Shah",
        "priyaships",
        "blue",
        false,
        "Infrastructure engineer. Thinking about tools that get out of your way. Demo profile.",
        "New York, NY",
        5400,
      ],
      [
        "demo-sam",
        "Sam Rivera",
        "samrivera",
        "blue",
        false,
        "First-time founder, long-time tinkerer. Fictional demo profile.",
        "San Francisco, CA",
        2300,
      ],
      [
        "demo-taylor",
        "Taylor Brooks",
        "taylorb",
        "blue",
        false,
        "Designer who still opens the terminal. Fictional demo profile.",
        "Seattle, WA",
        6700,
      ],
      [
        "demo-noah",
        "Noah Kim",
        "noahmakes",
        "blue",
        false,
        "Open source, community, and a good cup of coffee. Demo profile.",
        "Los Angeles, CA",
        4100,
      ],
      [
        "demo-ava",
        "Ava Patel",
        "avapatel",
        "blue",
        false,
        "Making the Toronto tech scene a little smaller. Fictional demo profile.",
        "Toronto, ON",
        3200,
      ],
    ] as const;
    for (const [
      id,
      name,
      handle,
      type,
      admin,
      bio,
      location,
      followers,
    ] of people) {
      await tx`INSERT INTO users(id,x_id,name,handle,bio,location,followers_count,following_count,verification_type,
        verification_checked_at,verification_expires_at,is_admin,admitted_at,onboarding_completed_at)
        VALUES(${id},${id},${name},${handle},${bio},${location},${followers},${237},${type},now(),
          ${type === "none" ? null : new Date(Date.now() + 86400000)},${admin},now(),now()) ON CONFLICT DO NOTHING`;
    }
    const posts = [
      [
        "demo-post-1",
        "sf",
        "demo-alex",
        "SF feels like a small town again. And I mean that in the best way.",
        "Had three completely unplanned conversations about things people are building on my walk to coffee this morning.\n\nOne person is working on accessible robotics, another is trying to make public transit data actually useful, and the third is opening a neighborhood bookstore.\n\nThere's something special about being somewhere that makes it normal to care this much. What's the most interesting thing you've stumbled into lately?",
        "text",
        null,
        ["Discussion"],
        1,
      ],
      [
        "demo-post-2",
        "ai",
        "demo-priya",
        "The best AI product feature we shipped was a button to turn it off",
        "We spent weeks improving our assistant's suggestions. Accuracy went up. Usage barely moved.\n\nThen we added a simple control: choose exactly where the assistant participates, and keep the rest of the workflow predictable. Adoption went up immediately.\n\nThe lesson for our team was that agency matters as much as capability. Curious how other teams are designing the boundary between helpful automation and unwanted interruption.",
        "text",
        null,
        ["Building in public"],
        2,
      ],
      [
        "demo-post-3",
        "y-combinator",
        "demo-sam",
        "What I wish someone told me before my first 20 customer interviews",
        "Stop asking if someone likes your idea. Ask them to show you the last time the problem happened.\n\nWe learned more from one screen share of a very messy spreadsheet than from a dozen polite conversations about our pitch.\n\nMy new checklist: ask about the past, ask for an example, and leave the deck closed. What question gets you past the polite answers?",
        "text",
        null,
        ["Founder lessons"],
        3,
      ],
      [
        "demo-post-4",
        "sf-restaurants",
        "demo-morgan",
        "A running list of places where you can actually hear your dinner conversation",
        "Putting together a small founder dinner and realizing that most recommendations optimize for food or atmosphere, but rarely for being able to hear the person across the table.\n\nWhat makes a good spot for six people who want to talk for two hours? Budget flexible, quiet corners highly appreciated. Share your go-to neighborhood and what makes the setup work.",
        "text",
        null,
        ["Ask the community"],
        4,
      ],
      [
        "demo-post-5",
        "open-source",
        "demo-noah",
        "Small, boring, useful: what open-source tool do you quietly rely on every day?",
        "The projects that change my workday usually aren't the ones with the splashy launches. They're the tiny utilities that do one thing well and never make me think about them.\n\nI'd love to hear about a project with a thoughtful maintainer and a narrow, useful purpose. Bonus points for a good first issue that someone here could pick up this weekend.",
        "text",
        null,
        ["Open source"],
        5,
      ],
      [
        "demo-post-6",
        "engineering",
        "demo-priya",
        "A reminder that the database can probably do that",
        "Before adding another service to the architecture, we've started writing down the requirement and checking whether Postgres already solves it.\n\nFull-text search, a durable work queue at our scale, advisory locks, JSON indexes: a lot of our supposedly separate infrastructure turned out to be a query and an index.\n\nThis isn't universal advice. It's a small-team constraint that has been working surprisingly well. What complexity have you removed lately?",
        "link",
        "https://www.postgresql.org/docs/current/",
        ["Engineering"],
        6,
      ],
      [
        "demo-post-7",
        "new-york",
        "demo-taylor",
        "NYC builders: where do you go when you need to get out of your apartment?",
        "Looking for places with a little energy, a big table, and no pressure to network. Coworking days, public libraries, casual meetups, all fair game.\n\nWould especially love recommendations from people working independently. Sometimes the best productivity tool is being near other people doing their thing.",
        "text",
        null,
        ["Community"],
        7,
      ],
      [
        "demo-post-8",
        "toronto",
        "demo-ava",
        "Let's make it easier to be new to the Toronto tech scene",
        "A few friends and I are putting together a small, recurring coffee hang for people who recently moved here or are getting into tech. No pitches, no panels, just introductions.\n\nWhat would have made your first month here easier? And if you've been around for a while, what's one thing you'd tell someone just arriving?",
        "text",
        null,
        ["Meet your people"],
        8,
      ],
      [
        "demo-post-9",
        "startups",
        "demo-alex",
        "The weekly update that actually helped us stay honest",
        "Every Friday we send the same three questions to the team:\n\n1. What did we learn from a customer?\n2. What did we ship because of it?\n3. What are we still avoiding?\n\nThe third question is uncomfortable in exactly the right way. It's exposed more important work than any metric dashboard. Sharing in case another tiny team finds it useful.",
        "text",
        null,
        ["Founder lessons"],
        9,
      ],
      [
        "demo-post-10",
        "seattle",
        "demo-taylor",
        "An appreciation thread for people who write great documentation",
        "Someone on an open-source project saved me an afternoon with a clear example and a note explaining why the obvious approach doesn't work.\n\nWe celebrate launches a lot. Today I'd like to celebrate the person who spent an extra hour explaining the weird edge case. What documentation has made your week better?",
        "text",
        null,
        ["Discussion"],
        10,
      ],
    ] as const;
    for (const [
      id,
      community,
      author,
      title,
      body,
      type,
      url,
      tags,
      hours,
    ] of posts) {
      await tx`INSERT INTO posts(id,community_id,author_id,title,body,type,url,tags,created_at)
        VALUES(${id},${community},${author},${title},${body},${type},${url},${tx.json([...tags])},${new Date(Date.now() - hours * 3600000)}) ON CONFLICT DO NOTHING`;
      for (const [index, person] of people.entries()) {
        if (person[0] !== "demo-jamie" && (index + hours) % 3 !== 0)
          await tx`INSERT INTO post_votes(user_id,post_id,value) VALUES(${person[0]},${id},1) ON CONFLICT DO NOTHING`;
      }
    }
    const comments = [
      [
        "demo-comment-1",
        "demo-post-1",
        "demo-priya",
        null,
        "The best conversations happen when nobody is trying to get anything from them. More walks, fewer calendar links.",
        0,
      ],
      [
        "demo-comment-2",
        "demo-post-1",
        "demo-noah",
        null,
        "Met someone at a cafe who was building a tool for their local food bank. Quietly one of the most thoughtful products I've seen this year.",
        0,
      ],
      [
        "demo-comment-3",
        "demo-post-1",
        "demo-alex",
        "demo-comment-2",
        "This is exactly what I mean. People solving a real problem for someone they actually know.",
        1,
      ],
      [
        "demo-comment-4",
        "demo-post-2",
        "demo-taylor",
        null,
        "Predictability is a feature. Letting people decide where the magic happens makes the magic feel trustworthy.",
        0,
      ],
      [
        "demo-comment-5",
        "demo-post-3",
        "demo-morgan",
        null,
        "Walk me through the last time you did this is still the best prompt in customer research.",
        0,
      ],
    ] as const;
    for (const [id, post, author, parent, body, depth] of comments) {
      await tx`INSERT INTO comments(id,post_id,author_id,parent_id,body,depth) VALUES(${id},${post},${author},${parent},${body},${depth}) ON CONFLICT DO NOTHING`;
      await tx`INSERT INTO comment_votes(user_id,comment_id,value) VALUES(${author},${id},1) ON CONFLICT DO NOTHING`;
    }
    const base = new Date();
    base.setUTCDate(base.getUTCDate() + 2);
    base.setUTCHours(1, 0, 0, 0);
    const events = [
      [
        "demo-event-1",
        "Build & Tell: a night for side projects",
        "Bring the thing you can't stop thinking about. Five-minute demos, thoughtful feedback, and good company. No pitch decks required. This is a fictional demo event.",
        "demo-morgan",
        "sf",
        "America/Los_Angeles",
        "Mission District",
        "sf-events",
        0,
        "grid",
        24,
        false,
        ["Demo night", "Builders"],
      ],
      [
        "demo-event-2",
        "Founders around the table",
        "An intimate dinner for early-stage founders. Trade honest stories, compare notes, and leave with a few new friends. Fictional demo event, not an actual reservation.",
        "demo-alex",
        "sf",
        "America/Los_Angeles",
        "Hayes Valley",
        "sf-restaurants",
        1,
        "dinner",
        12,
        true,
        ["Dinner", "Founders"],
      ],
      [
        "demo-event-3",
        "Coffee, code & good company",
        "A relaxed Sunday morning for engineers, designers, and anyone working on something. Bring your laptop or just yourself. Fictional demo event.",
        "demo-ava",
        "toronto",
        "America/Toronto",
        "King West",
        "toronto-events",
        3,
        "coffee",
        30,
        false,
        ["Coffee", "Community"],
      ],
      [
        "demo-event-4",
        "The NYC builder social",
        "A casual evening with people turning ideas into things. Swap stories, make a connection, and discover a new project. Fictional demo event.",
        "demo-priya",
        "new-york",
        "America/New_York",
        "Lower East Side",
        "ny-events",
        4,
        "city",
        50,
        false,
        ["Social", "Builders"],
      ],
    ] as const;
    for (const [
      id,
      title,
      description,
      host,
      city,
      timezone,
      venue,
      community,
      days,
      cover,
      capacity,
      approval,
      tags,
    ] of events) {
      const start = new Date(base.getTime() + days * 86400000);
      await tx`INSERT INTO events(id,host_id,title,description,source,city,timezone,starts_at,ends_at,venue,exact_address,
        venue_disclosure,capacity,requires_approval,cover_style,community_id,tags)
        VALUES(${id},${host},${title},${description},'native',${city},${timezone},${start},${new Date(start.getTime() + 7200000)},${venue},
          ${"Demo venue. This is not a real event address."},'attendees',${capacity},${approval},${cover},${community},${tx.json([...tags])}) ON CONFLICT DO NOTHING`;
      await tx`INSERT INTO event_rsvps(event_id,user_id,status,approved) VALUES(${id},${host},'going',true) ON CONFLICT DO NOTHING`;
    }
    for (const [id] of people)
      for (const community of [
        "sf",
        "ai",
        "startups",
        "open-source",
        "y-combinator",
      ]) {
        await tx`INSERT INTO community_memberships(user_id,community_id) VALUES(${id},${community}) ON CONFLICT DO NOTHING`;
      }
    await tx`INSERT INTO notifications(id,user_id,type,message,dedupe_key) VALUES('demo-welcome','demo-alex','welcome',
      'Welcome to Reddix. This development workspace contains fictional members and discussions.','demo-welcome') ON CONFLICT DO NOTHING`;
    await tx`INSERT INTO platform_settings(key,value) VALUES('demo_seed_v1','true') ON CONFLICT DO NOTHING`;
  });
}
