# Email Debugging Guide - Quick Reference

## What I Changed

### 1. Enhanced Logging (`api/subscribe.js`)
- Added `[EMAIL]` prefix to all email-related logs for easy filtering
- Added detailed error logging with full error object serialization
- Added logging for environment variable checks
- Added logging for email payload before sending

### 2. Fixed Resend API Format
- Removed `react: null` from email payload (not needed with `template_id`)
- Improved payload construction for better debugging

## How to Check Logs

### Step 1: Access Vercel Logs
1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your project
3. Click **"Functions"** tab
4. Click on **`/api/subscribe`** function
5. Look for logs with `[EMAIL]` prefix

### Step 2: Look for These Log Messages

#### ✅ Success Path:
```
[EMAIL] Checking Resend configuration: { hasApiKey: true, hasFrom: true, ... }
[EMAIL] Attempting to send welcome email to: user@example.com
[EMAIL] Using template_id: welcome-temp
[EMAIL] From address: Daily <daily@daily.sineday.app>
[EMAIL] Sending with payload: { from: ..., to: ..., template_id: ..., subject: ... }
[EMAIL] ✓ Welcome email sent successfully
[EMAIL] Resend response: { id: '...', from: '...', to: '...', createdAt: '...' }
```

#### ❌ Failure Paths:

**Missing Environment Variables:**
```
[EMAIL] Skipping welcome email: Missing environment variables
[EMAIL] RESEND_API_KEY present: false
[EMAIL] RESEND_FROM present: false
```

**Existing Subscriber:**
```
[EMAIL] Skipping welcome email: Existing subscriber (user@example.com)
[EMAIL] Subscriber was created at: 2024-01-01T00:00:00.000Z
```

**Resend API Error:**
```
[EMAIL] ✗ Failed to send welcome email
[EMAIL] Error type: Error
[EMAIL] Error message: [error message here]
[EMAIL] Error statusCode: [status code]
[EMAIL] Full error object: { ... }
```

## Common Issues & Solutions

### Issue 1: "Skipping welcome email: Existing subscriber"
**Cause**: User already exists in database  
**Solution**: 
- Test with a brand new email address
- Or delete the subscriber from Supabase database
- Or modify code to send email even for existing subscribers (if desired)

### Issue 2: "Missing RESEND_API_KEY or RESEND_FROM"
**Cause**: Environment variables not set in Vercel  
**Solution**:
1. Go to Vercel Dashboard → Settings → Environment Variables
2. Add:
   - `RESEND_API_KEY` = `re_...` (from Resend dashboard)
   - `RESEND_FROM` = `Daily <daily@daily.sineday.app>`
3. Redeploy the function

### Issue 3: Resend API Error (statusCode: 422, 401, etc.)
**Possible Causes**:
- **422**: Invalid template_id or domain not verified
- **401**: Invalid API key
- **403**: Domain not verified or API key doesn't have permission

**Solution**:
1. Check Resend Dashboard → Domains → Verify domain is verified
2. Check Resend Dashboard → Templates → Verify `welcome-temp` template exists
3. Verify API key is correct and has proper permissions

### Issue 4: Email Sent but Not Received
**Possible Causes**:
- Email in spam folder
- Domain reputation issues
- Email provider blocking

**Solution**:
1. Check Resend Dashboard → Emails → Check delivery status
2. Check spam folder
3. Verify domain DNS records (SPF, DKIM, DMARC)

## Quick Test Checklist

- [ ] Check Vercel logs for `[EMAIL]` messages
- [ ] Verify environment variables in Vercel dashboard
- [ ] Check Resend dashboard for email attempts
- [ ] Verify domain is verified in Resend
- [ ] Verify template_id `welcome-temp` exists in Resend
- [ ] Test with a completely new email address
- [ ] Check `/api/health` endpoint for Resend config status

## Testing the Health Endpoint

Call: `GET https://your-domain.vercel.app/api/health`

Expected response:
```json
{
  "ok": true,
  "env": {
    "RESEND_API_KEY": true,
    "RESEND_FROM": true,
    ...
  },
  "resend": true
}
```

If `resend: false`, check environment variables.

## Next Steps

1. **Deploy the updated code** to Vercel
2. **Test with a new email** address
3. **Check Vercel logs** immediately after testing
4. **Check Resend dashboard** for email attempts
5. **Review error messages** in logs to identify the specific issue
