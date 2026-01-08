# Email Sending Analysis - SineDay App

## Issue Summary
The app successfully adds subscribers to the database but emails are not being sent via Resend.

## Code Flow Analysis

### 1. Subscription Flow (`api/subscribe.js`)
- **Line 125-134**: Checks if subscriber already exists
- **Line 133**: Sets `isNewSubscriber` flag
- **Line 230**: Email is ONLY sent if `isNewSubscriber === true`
- **Line 231-232**: Checks for `RESEND_API_KEY` and `RESEND_FROM` env vars
- **Line 234**: Only proceeds if both env vars exist
- **Line 244-250**: Sends email using Resend template_id 'welcome-temp'

### 2. Potential Issues Identified

#### Issue #1: Email Only Sent for NEW Subscribers
**Location**: Line 230 in `api/subscribe.js`
- If a user already exists in the database, NO email is sent
- The code logs: "Skipping welcome email: Existing subscriber"
- **Action**: Check Vercel logs to see if this message appears

#### Issue #2: Missing Environment Variables
**Location**: Lines 231-232, 264
- If `RESEND_API_KEY` or `RESEND_FROM` are missing, email is skipped
- Warning logged: "Skipping welcome email: Missing RESEND_API_KEY or RESEND_FROM env vars"
- **Action**: Verify env vars in Vercel dashboard → Settings → Environment Variables

#### Issue #3: Resend API Format Issue
**Location**: Lines 244-250
- Current format uses `template_id` with `react: null` and `subject`
- When using `template_id`, you typically shouldn't set `react` or `subject` if they're defined in the template
- **Action**: Check Resend v3 API documentation for correct template usage

#### Issue #4: Silent Error Handling
**Location**: Lines 253-262
- Errors are caught and logged but don't fail the request
- Error details are logged but might not be visible in Vercel logs
- **Action**: Check Vercel function logs for error messages

#### Issue #5: Domain Verification
- Resend requires domain verification before sending emails
- If domain is not verified, emails will fail silently
- **Action**: Check Resend dashboard → Domains → Verify domain status

## Diagnostic Steps

### Step 1: Check Vercel Logs
1. Go to Vercel Dashboard → Your Project → Functions
2. Click on `/api/subscribe` function
3. Look for these log messages:
   - `"Subscriber status: NEW (email@example.com)"` or `"EXISTING"`
   - `"Sending welcome email to: email@example.com"`
   - `"✓ Welcome email sent successfully. Resend ID: ..."`
   - `"✗ Failed to send welcome email: ..."`
   - `"Skipping welcome email: Missing RESEND_API_KEY or RESEND_FROM env vars"`
   - `"Skipping welcome email: Existing subscriber"`

### Step 2: Check Environment Variables
1. Vercel Dashboard → Settings → Environment Variables
2. Verify these exist:
   - `RESEND_API_KEY` (should start with `re_`)
   - `RESEND_FROM` (should be like `Daily <daily@daily.sineday.app>`)
3. Ensure they're set for the correct environment (Production/Preview)

### Step 3: Check Resend Dashboard
1. Log into Resend dashboard
2. Go to "Emails" section
3. Check if any emails were attempted to be sent
4. Look for error statuses or bounce reasons
5. Go to "Domains" section
6. Verify domain `daily.sineday.app` is verified

### Step 4: Test Health Endpoint
Call `/api/health` to check:
- `env.RESEND_API_KEY` should be `true`
- `env.RESEND_FROM` should be `true`
- `resend` should be `true`

### Step 5: Check if Subscriber Already Exists
- If testing with the same email multiple times, the subscriber might already exist
- Try with a completely new email address
- Or check Supabase database to see subscriber status

## Recommended Fixes

### Fix #1: Enhanced Logging
Add more detailed logging around email sending to capture:
- Environment variable values (masked)
- Resend API response details
- Template ID validation

### Fix #2: Resend API Format
Verify correct format for Resend v3 with template_id:
- Remove `react: null` if not needed
- Verify `subject` is optional when using template_id
- Check if template_id 'welcome-temp' exists in Resend dashboard

### Fix #3: Error Response
Consider returning email send status in API response (without exposing sensitive data)

## Next Steps
1. Review Vercel function logs for the subscribe endpoint
2. Verify environment variables are set correctly
3. Check Resend dashboard for email attempts and domain status
4. Test with a brand new email address
5. Review enhanced logging output
