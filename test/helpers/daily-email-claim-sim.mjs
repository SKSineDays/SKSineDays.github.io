import { getLocalCivilDateTime, isWithinLocalSendWindow } from "../../api/_lib/daily-email.js";

function deliveryKey(subscriberId, sendDate) {
  return `${subscriberId}|email|${sendDate}`;
}

export function createDailyEmailStore() {
  return {
    subscribers: new Map(),
    preferences: new Map(),
    profiles: new Map(),
    deliveries: new Map()
  };
}

export function seedEligibleSubscriber(store, {
  id,
  email = "delivered+daily-sineday@resend.dev",
  timezone = "America/Chicago",
  status = "active",
  originDay = 1,
  emailEnabled = true,
  emailOptIn = true,
  emailOptInAt = "2026-01-01T00:00:00.000Z",
  sendHour = 6,
  sendMinute = 0
}) {
  store.subscribers.set(id, { id, email, timezone, status });
  store.preferences.set(id, {
    subscriber_id: id,
    email_enabled: emailEnabled,
    email_opt_in: emailOptIn,
    email_opt_in_at: emailOptInAt,
    send_hour_local: sendHour,
    send_minute_local: sendMinute
  });
  store.profiles.set(id, {
    subscriber_id: id,
    origin_day: originDay
  });
  return id;
}

export function claimDueDailyEmails(store, pNow, pLimit = 50) {
  const now = new Date(pNow);
  const due = [];

  for (const subscriber of store.subscribers.values()) {
    const preferences = store.preferences.get(subscriber.id);
    const profile = store.profiles.get(subscriber.id);
    if (subscriber.status !== "active") continue;
    if (!subscriber.email) continue;
    if (!preferences?.email_enabled || !preferences.email_opt_in || !preferences.email_opt_in_at) {
      continue;
    }
    if (!Number.isInteger(profile?.origin_day) || profile.origin_day < 1 || profile.origin_day > 18) {
      continue;
    }

    const local = getLocalCivilDateTime(now, subscriber.timezone);
    if (!local) continue;
    if (!isWithinLocalSendWindow(
      now,
      subscriber.timezone,
      preferences.send_hour_local,
      preferences.send_minute_local
    )) {
      continue;
    }

    const key = deliveryKey(subscriber.id, local.ymd);
    const existing = store.deliveries.get(key);
    if (existing?.status === "sent" || existing?.status === "skipped") continue;
    if (existing?.status === "processing") {
      const lastAttempt = new Date(existing.last_attempt_at || existing.created_at).getTime();
      if (now.getTime() - lastAttempt < 10 * 60 * 1000) continue;
    }

    due.push({ subscriber, profile, local, key, existing });
  }

  due.sort((a, b) => a.subscriber.id.localeCompare(b.subscriber.id));
  const claimed = [];

  for (const row of due.slice(0, pLimit)) {
    let delivery = row.existing;
    if (!delivery) {
      delivery = {
        id: `11111111-1111-4111-8111-${String(store.deliveries.size + 1).padStart(12, "0")}`,
        subscriber_id: row.subscriber.id,
        channel: "email",
        send_date: row.local.ymd,
        status: "processing",
        attempt_count: 1,
        last_attempt_at: now.toISOString(),
        created_at: now.toISOString(),
        local_timezone: row.subscriber.timezone,
        error: null
      };
    } else if (
      delivery.status === "queued" ||
      delivery.status === "failed" ||
      delivery.status === "processing"
    ) {
      delivery = {
        ...delivery,
        status: "processing",
        attempt_count: delivery.attempt_count + 1,
        last_attempt_at: now.toISOString(),
        error: null
      };
    } else {
      continue;
    }

    store.deliveries.set(row.key, delivery);
    claimed.push({
      delivery_id: delivery.id,
      subscriber_id: row.subscriber.id,
      email: row.subscriber.email,
      timezone: row.subscriber.timezone,
      local_date: row.local.ymd,
      origin_day: row.profile.origin_day
    });
  }

  return claimed;
}

export function getDelivery(store, subscriberId, sendDate) {
  return store.deliveries.get(deliveryKey(subscriberId, sendDate)) || null;
}
