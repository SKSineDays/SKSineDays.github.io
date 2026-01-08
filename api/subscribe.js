/**
 * Vercel serverless function for email subscription signup
 *
 * POST /api/subscribe
 * Body: { email, consent, timezone, birth_day_of_year, sineday_index, source }
 *
 * IMPORTANT: Uses SUPABASE_SERVICE_ROLE_KEY - NEVER expose this in the browser.
 * All writes to Supabase happen server-side via this API route.
 */

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

/**
 * Email validation regex
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate email format
 */
function isValidEmail(email) {
  return EMAIL_REGEX.test(email);
}

/**
 * Main handler
 */
export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({
      ok: false,
      error: 'Method not allowed'
    });
  }

  // CORS headers for browser requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Parse request body
    const {
      email,
      consent,
      timezone,
      birth_day_of_year,
      sineday_index,
      source
    } = req.body;

    // Validate required fields
    if (!email || !consent) {
      return res.status(400).json({
        ok: false,
        error: 'Email and consent are required'
      });
    }

    // Validate email format
    if (!isValidEmail(email)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid email format'
      });
    }

    // Validate consent
    if (consent !== true) {
      return res.status(400).json({
        ok: false,
        error: 'Consent is required to subscribe'
      });
    }

    // Validate timezone if provided
    const validTimezone = timezone || 'America/Chicago';

    // Validate birth_day_of_year if provided
    if (birth_day_of_year !== null && birth_day_of_year !== undefined) {
      if (birth_day_of_year < 1 || birth_day_of_year > 366) {
        return res.status(400).json({
          ok: false,
          error: 'Invalid birth_day_of_year (must be 1-366)'
        });
      }
    }

    // Validate sineday_index if provided
    if (sineday_index !== null && sineday_index !== undefined) {
      if (sineday_index < 0 || sineday_index > 17) {
        return res.status(400).json({
          ok: false,
          error: 'Invalid sineday_index (must be 0-17)'
        });
      }
    }

    // Initialize Supabase client with SERVICE ROLE KEY
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing Supabase environment variables');
      return res.status(500).json({
        ok: false,
        error: 'Server configuration error'
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    // 1. Upsert subscriber
    const { data: subscriber, error: subscriberError } = await supabase
      .from('subscribers')
      .upsert(
        {
          email: email.toLowerCase().trim(),
          timezone: validTimezone,
          status: 'active',
          source: source || 'homepage'
        },
        {
          onConflict: 'email',
          ignoreDuplicates: false
        }
      )
      .select()
      .single();

    if (subscriberError) {
      console.error('Subscriber upsert error:', subscriberError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to create subscriber'
      });
    }

    if (!subscriber || !subscriber.id) {
      console.error('No subscriber ID returned');
      return res.status(500).json({
        ok: false,
        error: 'Failed to create subscriber'
      });
    }

    // Detect if this is a new subscriber (compare timestamps)
    const isNewSubscriber = subscriber.created_at === subscriber.updated_at;
    console.log(`Subscriber status: ${isNewSubscriber ? 'NEW' : 'EXISTING'} (${email})`);

    // 2. Upsert preferences
    const now = new Date().toISOString();
    const { error: preferencesError } = await supabase
      .from('subscriber_preferences')
      .upsert(
        {
          subscriber_id: subscriber.id,
          email_enabled: true,
          sms_enabled: false,
          email_opt_in: true,
          sms_opt_in: false,
          email_opt_in_at: now,
          send_hour_local: 7,
          send_minute_local: 0,
          updated_at: now
        },
        {
          onConflict: 'subscriber_id',
          ignoreDuplicates: false
        }
      );

    if (preferencesError) {
      console.error('Preferences upsert error:', preferencesError);
      // Don't fail the whole request, just log it
    }

    // 3. Upsert profile (if we have birth_day_of_year or sineday_index)
    if (birth_day_of_year !== null && birth_day_of_year !== undefined ||
        sineday_index !== null && sineday_index !== undefined) {
      const profileData = {
        subscriber_id: subscriber.id,
        updated_at: new Date().toISOString()
      };

      if (birth_day_of_year !== null && birth_day_of_year !== undefined) {
        profileData.birth_day_of_year = birth_day_of_year;
      }

      if (sineday_index !== null && sineday_index !== undefined) {
        profileData.sineday_index = sineday_index;
      }

      const { error: profileError } = await supabase
        .from('subscriber_profile')
        .upsert(
          profileData,
          {
            onConflict: 'subscriber_id',
            ignoreDuplicates: false
          }
        );

      if (profileError) {
        console.error('Profile upsert error:', profileError);
        // Don't fail the whole request, just log it
      }
    }

    // 4. Send welcome email (only for new subscribers)
    if (isNewSubscriber) {
      const resendApiKey = process.env.RESEND_API_KEY;
      const resendFrom = process.env.RESEND_FROM;

      if (resendApiKey && resendFrom) {
        try {
          const resend = new Resend(resendApiKey);

          console.log(`Sending welcome email to: ${email}`);

          // Send using the pre-existing Resend template "welcome-temp"
          // Template: "Welcome Temp." - contains the canonical 18-day SineDay explanation
          // Subject: "Welcome to Your SineDay 🌊" (defined in template)
          // From: Daily <daily@daily.sineday.app>
          const response = await resend.emails.send({
            from: resendFrom,
            to: [email],
            subject: 'Welcome to Your SineDay 🌊',
            react: null,
            template_id: 'welcome-temp'
          });

          console.log(`✓ Welcome email sent successfully. Resend ID: ${response.data?.id || response.id}`);
        } catch (emailError) {
          console.error('✗ Failed to send welcome email:', emailError);
          console.error('Error details:', {
            message: emailError.message,
            name: emailError.name,
            statusCode: emailError.statusCode,
            response: emailError.response?.data || emailError.response
          });
          // Don't fail the whole request if email fails
        }
      } else {
        console.warn('Skipping welcome email: Missing RESEND_API_KEY or RESEND_FROM env vars');
      }
    } else {
      console.log('Skipping welcome email: Existing subscriber');
    }

    // Success response
    return res.status(200).json({
      ok: true,
      message: 'Successfully subscribed'
    });

  } catch (error) {
    console.error('Unexpected error:', error);
    return res.status(500).json({
      ok: false,
      error: 'An unexpected error occurred'
    });
  }
}
