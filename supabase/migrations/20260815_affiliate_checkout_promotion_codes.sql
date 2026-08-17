begin;

alter table public.affiliates
  add column if not exists stripe_promotion_code_id text,
  add column if not exists stripe_promotion_code_created_at timestamptz;

create unique index if not exists affiliates_stripe_promotion_code_id_uidx
  on public.affiliates (stripe_promotion_code_id)
  where stripe_promotion_code_id is not null;

create or replace function public.create_affiliate_attribution(
  p_subscriber_user_id uuid,
  p_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := upper(btrim(p_code));
  v_affiliate public.affiliates%rowtype;
  v_existing record;
  v_attribution public.affiliate_attributions%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_subscriber_user_id::text, 0));

  select aa.*, a.code, a.display_name
  into v_existing
  from public.affiliate_attributions aa
  join public.affiliates a on a.id = aa.affiliate_id
  where aa.subscriber_user_id = p_subscriber_user_id;

  if found then
    if v_existing.status = 'active' and v_existing.code = v_code then
      return jsonb_build_object(
        'id', v_existing.id,
        'affiliate_id', v_existing.affiliate_id,
        'affiliate_code', v_existing.code,
        'affiliate_display_name', v_existing.display_name,
        'attributed_at', v_existing.attributed_at,
        'existing', true
      );
    end if;
    raise exception 'AFFILIATE_ATTRIBUTION_ALREADY_EXISTS';
  end if;

  select *
  into v_affiliate
  from public.affiliates
  where upper(code) = v_code
  for update;

  if not found or v_affiliate.status <> 'active' then
    raise exception 'AFFILIATE_CODE_NOT_ACTIVE';
  end if;

  if v_affiliate.user_id = p_subscriber_user_id then
    raise exception 'AFFILIATE_SELF_REFERRAL';
  end if;

  insert into public.affiliate_attributions (
    subscriber_user_id,
    affiliate_id,
    source_code
  )
  values (
    p_subscriber_user_id,
    v_affiliate.id,
    v_affiliate.code
  )
  returning * into v_attribution;

  return jsonb_build_object(
    'id', v_attribution.id,
    'affiliate_id', v_affiliate.id,
    'affiliate_code', v_affiliate.code,
    'affiliate_display_name', v_affiliate.display_name,
    'attributed_at', v_attribution.attributed_at,
    'existing', false
  );
exception
  when unique_violation then
    raise exception 'AFFILIATE_ATTRIBUTION_ALREADY_EXISTS';
end;
$$;

commit;
