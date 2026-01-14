# Stripe Subscription Implementation Guide

## Overview
This document describes the complete Stripe subscription setup for SineDay.app, including authentication, profile management, and payment integration.

## Files Changed/Created

### 1. Package Dependencies
**File:** `package.json`
- Added: `stripe@^17.6.0`

### 2. Vercel Configuration
**File:** `vercel.json` (NEW)
```json
{
  "functions": {
    "api/stripe-webhook.js": {
      "maxDuration": 10
    }
  }
}
```
**Purpose:** Configures webhook function timeout

### 3. API Endpoints Created

#### `/api/config.js` (NEW)
**Purpose:** Safely exposes public environment variables to the browser
- Returns: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `APP_URL`
- Method: GET
- CORS: Enabled

#### `/api/whoami.js` (NEW)
**Purpose:** Debug endpoint to verify user authentication
- Returns: User ID and email
- Method: GET
- Headers: `Authorization: Bearer <access_token>`
- CORS: Enabled

#### `/api/create-checkout-session.js` (NEW)
**Purpose:** Creates Stripe Checkout session for subscription
- Method: POST
- Headers: `Authorization: Bearer <access_token>`
- Returns: `{ ok: true, url: 'https://checkout.stripe.com/...' }`

**Logic:**
1. Authenticates user via Supabase token
2. Checks if Stripe customer exists in `subscriptions` table
3. Creates new Stripe customer if needed (with metadata: `supabase_user_id`)
4. Creates Checkout session with:
   - Mode: subscription
   - Line items: `STRIPE_PRICE_ID`
   - Success URL: `/dashboard.html?checkout=success&session_id={CHECKOUT_SESSION_ID}`
   - Cancel URL: `/dashboard.html?checkout=cancel`
   - Metadata: `supabase_user_id`
   - Client reference ID: `user_id`
5. Saves customer ID to Supabase if new
6. Returns checkout URL

#### `/api/create-portal-session.js` (NEW)
**Purpose:** Creates Stripe Billing Portal session for managing subscriptions
- Method: POST
- Headers: `Authorization: Bearer <access_token>`
- Returns: `{ ok: true, url: 'https://billing.stripe.com/...' }`

**Logic:**
1. Authenticates user
2. Retrieves `stripe_customer_id` from subscriptions table
3. Creates Billing Portal session
4. Return URL: `/dashboard.html`

#### `/api/stripe-webhook.js` (NEW)
**Purpose:** Handles Stripe webhook events and updates subscription status

**CRITICAL:** Requires raw body for signature verification

**Handled Events:**
- `checkout.session.completed` → Updates subscriptions table
- `customer.subscription.created` → Updates subscriptions table
- `customer.subscription.updated` → Updates status and period_end
- `customer.subscription.deleted` → Sets status to inactive

**Logic:**
1. Reads raw body from request stream (Buffer)
2. Verifies Stripe signature using `STRIPE_WEBHOOK_SECRET`
3. Extracts user ID from:
   - Priority 1: `metadata.supabase_user_id`
   - Priority 2: `client_reference_id`
   - Priority 3: Lookup by `customer_id` in subscriptions table
4. Updates `subscriptions` table:
   - `user_id`
   - `stripe_customer_id`
   - `stripe_subscription_id`
   - `status` (active, trialing, inactive, etc.)
   - `current_period_end` (converted from Unix timestamp)
   - `updated_at`
5. Returns 200 to acknowledge receipt

### 4. Frontend Files Created

#### `/dashboard.html` (NEW)
**Purpose:** Main dashboard page with authentication and subscription UI

**Sections:**
- Login card (email magic link)
- User info (email, sign out button)
- Subscription status (Premium Active / Free Plan)
- Upgrade button (if not paid)
- Manage Billing button (if paid)
- Profiles list (with add/delete)
- Calendars section (locked if not paid)

**Styling:** Inline CSS with clean, minimal design

#### `/js/supabase-client.js` (NEW)
**Purpose:** Supabase client initialization and auth utilities

**Exports:**
- `getSupabaseClient()` - Returns initialized client
- `getCurrentSession()` - Gets current session
- `getCurrentUser()` - Gets current user
- `getAccessToken()` - Gets access token for API calls
- `signInWithEmail(email)` - Sends magic link
- `signOut()` - Signs out user
- `onAuthStateChange(callback)` - Listens to auth changes

**Features:**
- Fetches config from `/api/config` on first load
- Caches config to avoid repeated requests
- Uses Supabase CDN (loaded in HTML)

#### `/js/dashboard.js` (NEW)
**Purpose:** Main dashboard logic

**Features:**
- **Authentication:**
  - Magic link login
  - Session recovery on page load
  - Auth state listener
  - Sign out

- **Profile Management:**
  - List profiles (ordered by created_at)
  - Add profile (name, birthdate, timezone)
  - Delete profile (with confirmation)
  - Max 10 profiles enforced (UI + DB)
  - Displays limit warning when at 10

- **Subscription Management:**
  - Fetches subscription status from Supabase
  - Displays Premium Active or Free Plan
  - Shows renewal date if paid
  - Upgrade button → creates checkout session → redirects to Stripe
  - Manage Billing button → creates portal session → redirects to Stripe

- **Checkout Success Handling:**
  - Detects `?checkout=success` in URL
  - Polls subscription status 5 times (every 2 seconds)
  - Shows success message when Premium activates
  - Cleans up URL after processing

- **Subscription Gating:**
  - Paid = status in (active, trialing)
  - Shows locked calendar section if not paid
  - Shows placeholder "coming next" if paid

- **Notifications:**
  - Toast-style notifications (success, error, info)
  - Auto-dismiss after 5 seconds

## Database Requirements

### Tables Expected (assumed to exist):

#### `public.profiles`
```sql
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  birthdate DATE,
  timezone TEXT DEFAULT 'America/Chicago',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- RLS policies
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profiles"
  ON public.profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own profiles"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own profiles"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own profiles"
  ON public.profiles FOR DELETE
  USING (auth.uid() = user_id);

-- Trigger to enforce max 10 profiles per user
CREATE OR REPLACE FUNCTION check_profile_limit()
RETURNS TRIGGER AS $$
BEGIN
  IF (SELECT COUNT(*) FROM public.profiles WHERE user_id = NEW.user_id) >= 10 THEN
    RAISE EXCEPTION 'Profile limit reached (10 max).';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_profile_limit
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION check_profile_limit();
```

#### `public.subscriptions`
```sql
CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  status TEXT DEFAULT 'inactive',
  current_period_end TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- RLS policies
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own subscription"
  ON public.subscriptions FOR SELECT
  USING (auth.uid() = user_id);

-- Note: Only service role can write (webhook uses service role)
```

## Environment Variables Required

**Vercel Environment Variables:**
```bash
# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJxxx...
SUPABASE_SERVICE_ROLE_KEY=eyJxxx...

# Stripe
STRIPE_SECRET_KEY=sk_test_xxx or sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_PRICE_ID=price_1SpIL1KKH9MbWW3vlOrrnYll

# App
APP_URL=https://sineday.app
```

**Note:** The app uses `price_1SpIL1KKH9MbWW3vlOrrnYll` and `prod_Tms5foiWKGnlbB` as mentioned in requirements.

## Stripe Setup Steps

### 1. Configure Webhook Endpoint
1. Go to Stripe Dashboard → Developers → Webhooks
2. Add endpoint: `https://sineday.app/api/stripe-webhook`
3. Select events to listen to:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Copy webhook signing secret to `STRIPE_WEBHOOK_SECRET` env var

### 2. Enable Billing Portal
1. Go to Stripe Dashboard → Settings → Billing → Customer Portal
2. Enable Customer Portal
3. Configure settings:
   - Allow customers to update payment methods: ✓
   - Allow customers to cancel subscriptions: ✓
   - Set cancellation behavior (immediate or end of period)

### 3. Verify Product & Price
- Product ID: `prod_Tms5foiWKGnlbB`
- Price ID: `price_1SpIL1KKH9MbWW3vlOrrnYll`
- Ensure price is set to recurring (subscription)

## Testing Checklist

### 1. Local Setup
```bash
# Install dependencies
npm install

# Deploy to Vercel or test locally with Vercel CLI
vercel dev
```

### 2. Test Authentication
1. Go to `/dashboard.html`
2. Enter email
3. Check email for magic link
4. Click link → should redirect back to dashboard signed in
5. Verify email shows in dashboard
6. Sign out → should return to login screen

### 3. Test Profiles
1. Sign in
2. Add profile with name, birthdate, timezone
3. Verify profile appears in list
4. Add 9 more profiles (total 10)
5. Verify "limit reached" message appears
6. Verify Add button is disabled
7. Delete a profile
8. Verify limit message disappears
9. Add button re-enabled

### 4. Test Stripe Checkout Flow
1. Sign in (while subscription is inactive)
2. Verify "Free Plan" shows
3. Click "Upgrade to Premium"
4. Should redirect to Stripe Checkout
5. Use test card: `4242 4242 4242 4242`, any future date, any CVC
6. Complete payment
7. Should redirect back to `/dashboard.html?checkout=success`
8. Wait for subscription to activate (polling)
9. Verify "Premium Active" shows
10. Verify "Manage Billing" button appears
11. Verify calendars section unlocked

### 5. Test Stripe Webhook
1. Complete a checkout (step 4 above)
2. Check Stripe Dashboard → Developers → Webhooks → Your endpoint
3. Verify webhook events were sent
4. Verify all returned 200 OK
5. Check Supabase `subscriptions` table
6. Verify row exists with:
   - `user_id`
   - `stripe_customer_id`
   - `stripe_subscription_id`
   - `status = 'active'` or `'trialing'`
   - `current_period_end` (future date)

### 6. Test Billing Portal
1. Sign in as paid user
2. Click "Manage Billing"
3. Should redirect to Stripe Billing Portal
4. Verify can update payment method
5. Verify can cancel subscription
6. If cancel, verify webhook updates status to inactive
7. Verify dashboard shows "Free Plan" after cancel

### 7. Test Debug Endpoint
```bash
# Get access token from browser console:
# const session = await supabase.auth.getSession()
# console.log(session.data.session.access_token)

curl -H "Authorization: Bearer <access_token>" https://sineday.app/api/whoami

# Should return:
# {"ok":true,"user_id":"xxx","email":"user@example.com"}
```

## Troubleshooting

### Webhook Returns 400 "Invalid signature"
- Verify `STRIPE_WEBHOOK_SECRET` is correct
- Check Vercel function logs for raw body handling
- Ensure webhook endpoint URL is exactly `https://sineday.app/api/stripe-webhook`

### Webhook Updates Not Appearing
- Check Stripe Dashboard → Webhooks → Event logs
- Verify events have status 200
- Check Vercel function logs for errors
- Verify `SUPABASE_SERVICE_ROLE_KEY` is set
- Check Supabase logs for RLS policy errors

### Magic Link Not Working
- Verify Supabase email templates are configured
- Check spam folder
- Verify `APP_URL` is set correctly
- Check Supabase dashboard → Authentication → Email Templates
- Ensure redirect URLs are whitelisted in Supabase

### Profiles Not Saving
- Check browser console for errors
- Verify RLS policies are set correctly
- Test `/api/whoami` to confirm auth is working
- Check Supabase logs

### Checkout Session Not Creating
- Check browser console for errors
- Verify `STRIPE_SECRET_KEY` and `STRIPE_PRICE_ID` are set
- Test `/api/whoami` first
- Check Vercel function logs

### Subscription Status Not Updating After Checkout
- Wait 30 seconds (webhook may be delayed)
- Check Stripe webhook delivery logs
- Manually trigger webhook test from Stripe Dashboard
- Check `subscriptions` table in Supabase directly

## Additional Notes

### Security Considerations
- Never expose `STRIPE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` to browser
- Always validate auth tokens server-side
- RLS policies prevent users from accessing other users' data
- Webhook signature verification prevents replay attacks

### Performance
- Config endpoint caches results in browser
- Supabase client persists sessions in localStorage
- Checkout success polling runs max 5 times over 10 seconds

### Scaling
- All endpoints are serverless (auto-scaling)
- Webhook is idempotent (can be retried safely)
- Supabase connection pooling handles concurrent requests

### Future Enhancements
- Add calendar generation based on profiles
- Add email notifications for subscription changes
- Add proration for mid-cycle changes
- Add annual subscription option
- Add coupon code support

## Testing with Stripe CLI (Optional)

```bash
# Install Stripe CLI
# https://stripe.com/docs/stripe-cli

# Login
stripe login

# Forward webhooks to local development
stripe listen --forward-to http://localhost:3000/api/stripe-webhook

# Trigger test events
stripe trigger checkout.session.completed
stripe trigger customer.subscription.created
stripe trigger customer.subscription.updated
stripe trigger customer.subscription.deleted
```

## Summary

This implementation provides a complete subscription system with:
- ✓ Email authentication (magic links)
- ✓ Profile management (max 10 per user)
- ✓ Stripe Checkout integration
- ✓ Stripe Billing Portal integration
- ✓ Webhook handling for subscription updates
- ✓ Subscription gating for premium features
- ✓ Polling for checkout success
- ✓ Clean error handling
- ✓ Security best practices
- ✓ Debug endpoint for testing

All code uses ESM format as required by `"type": "module"` in package.json.
