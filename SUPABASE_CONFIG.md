# Supabase Configuration for Magic Link Authentication

This document describes the required Supabase Dashboard configuration to ensure magic link redirects work correctly.

## URL Configuration Steps

1. **Go to Supabase Dashboard**
   - Navigate to your project in [Supabase Dashboard](https://app.supabase.com)
   - Go to **Authentication** → **URL Configuration**

2. **Set Site URL**
   ```
   Site URL: https://sineday.app
   ```

3. **Add Redirect URLs**
   Add the following URLs to the "Redirect URLs" list:
   ```
   https://sineday.app/dashboard.html
   https://sineday.app/
   ```

## How It Works

### Magic Link Flow

1. **User requests magic link**:
   - User enters email on login page
   - Frontend calls `signInWithOtp()` with `emailRedirectTo: "https://sineday.app/dashboard.html"`

2. **Supabase sends email**:
   - Email contains a magic link with a PKCE code parameter
   - Link format: `https://sineday.app/dashboard.html?code=...`

3. **User clicks link**:
   - Browser navigates to dashboard with `?code=...` parameter
   - Dashboard JavaScript detects the code parameter

4. **PKCE exchange**:
   - Dashboard calls `supabase.auth.exchangeCodeForSession(window.location.href)`
   - Supabase validates the code and creates a session
   - URL is cleaned with `history.replaceState()` to remove the code

5. **User is authenticated**:
   - Dashboard displays authenticated content
   - User can now access their profiles and subscription

## Code Implementation

### Backend Configuration
- **File**: `api/config.js`
- **Setting**: `appUrl: process.env.APP_URL || 'https://sineday.app'`

### Frontend Magic Link Request
- **File**: `js/supabase-client.js`
- **Function**: `signInWithEmail()`
- **Key setting**: `emailRedirectTo: ${config.appUrl}/dashboard.html`

### Frontend PKCE Handler
- **File**: `js/dashboard.js`
- **Function**: `handleAuthCallback()`
- **Key logic**:
  ```javascript
  if (searchParams.has('code')) {
    await client.auth.exchangeCodeForSession(window.location.href);
    window.history.replaceState({}, '', '/dashboard.html');
  }
  ```

## Environment Variables

Ensure the following environment variable is set in your deployment platform (Vercel):

```
APP_URL=https://sineday.app
```

This ensures the correct redirect URL is used in all magic link emails.

## Troubleshooting

### Magic link redirects to wrong URL
- Verify Site URL in Supabase Dashboard matches your production domain
- Check that `APP_URL` environment variable is set correctly
- Ensure redirect URLs list includes both `/dashboard.html` and `/`

### User clicks link but stays logged out
- Check browser console for PKCE exchange errors
- Verify `exchangeCodeForSession()` is being called
- Ensure Supabase client has `detectSessionInUrl: true` (default)

### "Invalid redirect URL" error
- The redirect URL must be in the Supabase Dashboard's allowed list
- URL must match exactly (including protocol and trailing slash where applicable)
