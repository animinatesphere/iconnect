CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name varchar(80) NOT NULL,
  username varchar(30) NOT NULL,
  email varchar(254) NOT NULL UNIQUE,
  password_hash text NOT NULL,
  bio varchar(120) NOT NULL DEFAULT '',
  interests text[] NOT NULL DEFAULT '{}',
  profile_visible boolean NOT NULL DEFAULT true,
  discoverable boolean NOT NULL DEFAULT true,
  email_verified_at timestamptz,
  suspended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_visible boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS discoverable boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image_url varchar(2048);

CREATE TABLE IF NOT EXISTS email_verification_codes (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code_hash char(64) NOT NULL,
  expires_at timestamptz NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5)
);

CREATE INDEX IF NOT EXISTS users_email_verified_at_idx
  ON users(email_verified_at);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash varchar(64) NOT NULL PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS auth_sessions_expires_at_idx
  ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  subject_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action varchar(40) NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE admin_audit_log
  ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS admin_audit_log_created_at_idx
  ON admin_audit_log(created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS admin_audit_log_subject_created_at_idx
  ON admin_audit_log(subject_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_roles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_roles_created_at_idx
  ON admin_roles(created_at DESC);

CREATE TABLE IF NOT EXISTS social_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body varchar(500) NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 500),
  image_urls text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE social_posts
  ADD COLUMN IF NOT EXISTS image_urls text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS social_posts_created_at_idx
  ON social_posts(created_at DESC);

CREATE TABLE IF NOT EXISTS social_post_likes (
  post_id uuid NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS social_post_bookmarks (
  post_id uuid NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS social_post_bookmarks_user_created_at_idx
  ON social_post_bookmarks(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS social_post_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_comment_id uuid REFERENCES social_post_comments(id) ON DELETE CASCADE,
  body varchar(280) NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 280),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE social_post_comments
  ADD COLUMN IF NOT EXISTS parent_comment_id uuid
  REFERENCES social_post_comments(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS social_post_comments_created_at_idx
  ON social_post_comments(post_id, created_at);

CREATE INDEX IF NOT EXISTS social_post_comments_parent_idx
  ON social_post_comments(parent_comment_id, created_at)
  WHERE parent_comment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS direct_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_one_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  participant_two_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT direct_conversations_distinct_participants
    CHECK (participant_one_id < participant_two_id),
  CONSTRAINT direct_conversations_unique_pair
    UNIQUE (participant_one_id, participant_two_id)
);

CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_blocks_distinct_users CHECK (blocker_id <> blocked_id),
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS direct_conversation_preferences (
  conversation_id uuid NOT NULL REFERENCES direct_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_muted boolean NOT NULL DEFAULT false,
  is_archived boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS direct_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES direct_conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body varchar(2000) NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  image_url varchar(2048),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  CONSTRAINT direct_messages_distinct_participants CHECK (sender_id <> recipient_id)
);

ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS image_url varchar(2048);
ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS audio_url varchar(2048);
ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS edited_at timestamptz;

CREATE INDEX IF NOT EXISTS direct_conversations_participant_one_idx
  ON direct_conversations(participant_one_id);

CREATE INDEX IF NOT EXISTS direct_conversations_participant_two_idx
  ON direct_conversations(participant_two_id);

CREATE INDEX IF NOT EXISTS direct_messages_conversation_created_at_idx
  ON direct_messages(conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS direct_messages_unread_idx
  ON direct_messages(conversation_id, recipient_id)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS users_username_prefix_idx
  ON users(lower(username) text_pattern_ops)
  WHERE email_verified_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS users_display_name_prefix_idx
  ON users(lower(display_name) text_pattern_ops)
  WHERE email_verified_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_follows (
  follower_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_follows_distinct_users CHECK (follower_id <> following_id),
  PRIMARY KEY (follower_id, following_id)
);

CREATE INDEX IF NOT EXISTS user_follows_following_id_idx
  ON user_follows(following_id, follower_id);

CREATE TABLE IF NOT EXISTS communities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name varchar(80) NOT NULL,
  description varchar(500) NOT NULL
    CHECK (char_length(btrim(description)) BETWEEN 1 AND 500),
  image_url varchar(2048),
  rules text NOT NULL DEFAULT '',
  members_can_post boolean NOT NULL DEFAULT true,
  membership_mode varchar(10) NOT NULL DEFAULT 'open'
    CHECK (membership_mode IN ('open', 'approval')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE communities ADD COLUMN IF NOT EXISTS image_url varchar(2048);
ALTER TABLE communities ADD COLUMN IF NOT EXISTS rules text NOT NULL DEFAULT '';
ALTER TABLE communities ADD COLUMN IF NOT EXISTS members_can_post boolean NOT NULL DEFAULT true;
ALTER TABLE communities
  ADD COLUMN IF NOT EXISTS membership_mode varchar(10) NOT NULL DEFAULT 'open';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'communities_membership_mode_check'
      AND conrelid = 'communities'::regclass
  ) THEN
    ALTER TABLE communities
      ADD CONSTRAINT communities_membership_mode_check
      CHECK (membership_mode IN ('open', 'approval'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS communities_created_at_idx
  ON communities(created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS community_memberships (
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id, user_id)
);

CREATE INDEX IF NOT EXISTS community_memberships_user_id_idx
  ON community_memberships(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS community_join_requests (
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status varchar(10) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'declined', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id, user_id)
);

CREATE INDEX IF NOT EXISTS community_join_requests_pending_idx
  ON community_join_requests(community_id, created_at)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS community_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body varchar(500) NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 500),
  image_urls text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS community_posts_created_at_idx
  ON community_posts(community_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS users_discoverable_profile_idx
  ON users(lower(display_name), lower(username))
  WHERE email_verified_at IS NOT NULL AND profile_visible AND discoverable;

CREATE TABLE IF NOT EXISTS job_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title varchar(120) NOT NULL,
  company varchar(120) NOT NULL,
  location varchar(120) NOT NULL,
  employment_type varchar(40) NOT NULL,
  workplace_type varchar(12) NOT NULL
    CHECK (workplace_type IN ('remote', 'hybrid', 'onsite')),
  summary varchar(250) NOT NULL,
  description varchar(5000) NOT NULL,
  company_image_url varchar(2048),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE job_listings ADD COLUMN IF NOT EXISTS company_image_url varchar(2048);

CREATE INDEX IF NOT EXISTS job_listings_created_at_idx
  ON job_listings(created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS job_business_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  company_name varchar(120) NOT NULL,
  registration_number varchar(80) NOT NULL,
  business_type varchar(80) NOT NULL,
  business_address varchar(240) NOT NULL,
  contact_phone varchar(40) NOT NULL,
  description varchar(1000) NOT NULL,
  document_filename varchar(40) NOT NULL UNIQUE,
  document_content_type varchar(32) NOT NULL
    CHECK (document_content_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  document_size bigint NOT NULL CHECK (document_size > 0),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS job_bookmarks (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES job_listings(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, job_id)
);

CREATE INDEX IF NOT EXISTS job_bookmarks_job_id_idx
  ON job_bookmarks(job_id, user_id);

CREATE TABLE IF NOT EXISTS job_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES job_listings(id) ON DELETE CASCADE,
  applicant_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cover_letter varchar(2000) NOT NULL DEFAULT '',
  status varchar(20) NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'reviewing', 'accepted', 'declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_applications_unique_applicant UNIQUE (job_id, applicant_id)
);

CREATE INDEX IF NOT EXISTS job_applications_applicant_created_at_idx
  ON job_applications(applicant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS marketplace_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  category varchar(12) NOT NULL
    CHECK (category IN ('Style', 'Tech', 'Home', 'Other')),
  price bigint NOT NULL CHECK (price > 0),
  stock integer NOT NULL CHECK (stock >= 0),
  description varchar(2000) NOT NULL
    CHECK (char_length(btrim(description)) BETWEEN 1 AND 2000),
  image_url varchar(2048),
  image_urls text[] NOT NULL DEFAULT '{}',
  published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE marketplace_products
  ADD COLUMN IF NOT EXISTS image_urls text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS marketplace_products_published_created_at_idx
  ON marketplace_products(created_at DESC, id DESC)
  WHERE published;

CREATE INDEX IF NOT EXISTS marketplace_products_seller_id_idx
  ON marketplace_products(seller_id, created_at DESC);

CREATE TABLE IF NOT EXISTS marketplace_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  seller_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES marketplace_products(id) ON DELETE RESTRICT,
  product_name varchar(120) NOT NULL,
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 1000),
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor > 0),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  marketplace_commission_minor bigint NOT NULL CHECK (marketplace_commission_minor >= 0),
  seller_amount_minor bigint NOT NULL CHECK (seller_amount_minor >= 0),
  currency varchar(3) NOT NULL CHECK (currency IN ('NGN')),
  status varchar(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'fulfilled', 'payment_failed', 'expired', 'refund_required')),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 minutes',
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  fulfilled_at timestamptz
);

ALTER TABLE marketplace_orders
  DROP CONSTRAINT IF EXISTS marketplace_orders_status_check;

ALTER TABLE marketplace_orders
  ADD CONSTRAINT marketplace_orders_status_check
  CHECK (status IN ('pending', 'paid', 'fulfilled', 'payment_failed', 'expired', 'refund_required'));

CREATE INDEX IF NOT EXISTS marketplace_orders_buyer_created_idx
  ON marketplace_orders(buyer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS marketplace_orders_seller_created_idx
  ON marketplace_orders(seller_id, created_at DESC);

CREATE INDEX IF NOT EXISTS marketplace_orders_pending_expiration_idx
  ON marketplace_orders(expires_at)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS user_statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  image_url varchar(2048) NOT NULL,
  caption varchar(500) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours'
);

CREATE INDEX IF NOT EXISTS user_statuses_active_user_created_idx
  ON user_statuses(user_id, expires_at, created_at DESC);

CREATE TABLE IF NOT EXISTS user_status_views (
  status_id uuid NOT NULL REFERENCES user_statuses(id) ON DELETE CASCADE,
  viewer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (status_id, viewer_id)
);

CREATE INDEX IF NOT EXISTS user_status_views_viewer_idx
  ON user_status_views(viewer_id, viewed_at DESC);

CREATE TABLE IF NOT EXISTS savings_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name varchar(100) NOT NULL,
  target_amount bigint NOT NULL CHECK (target_amount > 0),
  contribution_amount bigint NOT NULL CHECK (contribution_amount > 0),
  frequency varchar(8) NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  target_date date,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS savings_plans_user_created_idx
  ON savings_plans(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS savings_contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES savings_plans(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount bigint NOT NULL CHECK (amount > 0),
  note varchar(240) NOT NULL DEFAULT '',
  contributed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS savings_contributions_plan_created_idx
  ON savings_contributions(plan_id, contributed_at DESC);

CREATE TABLE IF NOT EXISTS dating_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  birth_date date NOT NULL,
  gender varchar(20) NOT NULL CHECK (gender IN ('woman', 'man', 'non_binary')),
  seeking varchar(20) NOT NULL CHECK (seeking IN ('women', 'men', 'non_binary', 'everyone')),
  location varchar(120) NOT NULL,
  bio varchar(500) NOT NULL,
  interests text[] NOT NULL DEFAULT '{}',
  image_urls text[] NOT NULL,
  active boolean NOT NULL DEFAULT true,
  terms_accepted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dating_profiles_active_idx
  ON dating_profiles(active, updated_at DESC);

CREATE TABLE IF NOT EXISTS dating_swipes (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  liked boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dating_swipes_distinct_users CHECK (user_id <> target_user_id),
  PRIMARY KEY (user_id, target_user_id)
);

CREATE TABLE IF NOT EXISTS dating_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_one_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  participant_two_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dating_matches_distinct_participants CHECK (participant_one_id < participant_two_id),
  CONSTRAINT dating_matches_unique_pair UNIQUE (participant_one_id, participant_two_id)
);

CREATE INDEX IF NOT EXISTS dating_matches_participant_one_idx
  ON dating_matches(participant_one_id, created_at DESC);
CREATE INDEX IF NOT EXISTS dating_matches_participant_two_idx
  ON dating_matches(participant_two_id, created_at DESC);

CREATE TABLE IF NOT EXISTS dating_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES dating_matches(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body varchar(2000) NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);

CREATE INDEX IF NOT EXISTS dating_messages_match_created_idx
  ON dating_messages(match_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS dating_blocks (
  blocker_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dating_blocks_distinct_users CHECK (blocker_id <> blocked_id),
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS dating_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason varchar(24) NOT NULL CHECK (reason IN ('inappropriate', 'fake_profile', 'harassment', 'other')),
  details varchar(1000) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dating_reports_distinct_users CHECK (reporter_id <> reported_id)
);

CREATE INDEX IF NOT EXISTS dating_reports_created_idx
  ON dating_reports(created_at DESC);

CREATE TABLE IF NOT EXISTS local_marketplace_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category varchar(12) NOT NULL
    CHECK (category IN ('Homes', 'Services', 'Farm')),
  title varchar(120) NOT NULL,
  price varchar(80) NOT NULL,
  location varchar(120) NOT NULL,
  detail varchar(280) NOT NULL,
  description varchar(2000) NOT NULL
    CHECK (char_length(btrim(description)) BETWEEN 1 AND 2000),
  image_url varchar(2048),
  published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS local_marketplace_listings_published_created_at_idx
  ON local_marketplace_listings(created_at DESC, id DESC)
  WHERE published;

CREATE INDEX IF NOT EXISTS local_marketplace_listings_category_location_idx
  ON local_marketplace_listings(category, lower(location))
  WHERE published;

CREATE TABLE IF NOT EXISTS videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title varchar(120) NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  caption varchar(500) NOT NULL DEFAULT '',
  filename varchar(40) NOT NULL UNIQUE,
  content_type varchar(32) NOT NULL CHECK (content_type IN ('video/mp4', 'video/webm')),
  file_size bigint NOT NULL CHECK (file_size > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS videos_created_at_idx
  ON videos(created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS videos_user_created_at_idx
  ON videos(user_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS live_streams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title varchar(100) NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 100),
  room_name varchar(36) NOT NULL UNIQUE,
  status varchar(8) NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'ended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_heartbeat_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);

CREATE INDEX IF NOT EXISTS live_streams_live_created_at_idx
  ON live_streams(created_at DESC, id DESC)
  WHERE status = 'live';

CREATE UNIQUE INDEX IF NOT EXISTS live_streams_one_live_per_host_idx
  ON live_streams(host_id)
  WHERE status = 'live';

CREATE TABLE IF NOT EXISTS subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(80) NOT NULL,
  currency varchar(3) NOT NULL CHECK (currency IN ('NGN', 'USD')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  posting_limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  paystack_plan_code varchar(120),
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscription_plans_active_currency_idx
  ON subscription_plans(currency, amount_minor)
  WHERE active;

ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS paystack_plan_code varchar(120);

CREATE TABLE IF NOT EXISTS posting_quota_settings (
  id smallint PRIMARY KEY CHECK (id = 1),
  free_monthly_limits jsonb NOT NULL DEFAULT
    '{"jobs":1,"products":1,"marketplace":1,"videos":1}'::jsonb,
  free_daily_dating_likes integer NOT NULL DEFAULT 10
    CHECK (free_daily_dating_likes BETWEEN 0 AND 1000),
  marketplace_commission_bps integer NOT NULL DEFAULT 500
    CHECK (marketplace_commission_bps BETWEEN 0 AND 3000),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE posting_quota_settings
  ADD COLUMN IF NOT EXISTS marketplace_commission_bps integer NOT NULL DEFAULT 500
    CHECK (marketplace_commission_bps BETWEEN 0 AND 3000);

INSERT INTO posting_quota_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS billing_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
  provider varchar(12) NOT NULL CHECK (provider IN ('paystack', 'stripe')),
  provider_subscription_id varchar(160),
  provider_customer_id varchar(160),
  provider_email_token text,
  status varchar(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'past_due', 'cancelled', 'expired')),
  currency varchar(3) NOT NULL CHECK (currency IN ('NGN', 'USD')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_subscriptions_provider_id_idx
  ON billing_subscriptions(provider, provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS billing_subscriptions_user_status_idx
  ON billing_subscriptions(user_id, status, current_period_end DESC);

CREATE TABLE IF NOT EXISTS billing_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id uuid REFERENCES billing_subscriptions(id) ON DELETE SET NULL,
  plan_id uuid REFERENCES subscription_plans(id) ON DELETE SET NULL,
  dating_product_id uuid,
  provider varchar(12) NOT NULL CHECK (provider IN ('paystack', 'stripe')),
  provider_reference varchar(200) NOT NULL,
  provider_plan_code varchar(120),
  transaction_type varchar(24) NOT NULL
    CHECK (transaction_type IN ('subscription', 'dating_boost', 'dating_likes')),
  currency varchar(3) NOT NULL CHECK (currency IN ('NGN', 'USD')),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  status varchar(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  UNIQUE (provider, provider_reference)
);

ALTER TABLE billing_transactions
  DROP CONSTRAINT IF EXISTS billing_transactions_transaction_type_check;

ALTER TABLE billing_transactions
  ADD CONSTRAINT billing_transactions_transaction_type_check
  CHECK (transaction_type IN ('subscription', 'dating_boost', 'dating_likes', 'marketplace_order'));

ALTER TABLE billing_transactions
  ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES marketplace_orders(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS billing_transactions_order_id_idx
  ON billing_transactions(order_id)
  WHERE order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS billing_transactions_paid_at_idx
  ON billing_transactions(paid_at DESC)
  WHERE status = 'paid';

CREATE INDEX IF NOT EXISTS billing_transactions_user_created_idx
  ON billing_transactions(user_id, created_at DESC);

ALTER TABLE billing_subscriptions
  ADD COLUMN IF NOT EXISTS provider_email_token text;

ALTER TABLE billing_transactions
  ADD COLUMN IF NOT EXISTS provider_plan_code varchar(120);

CREATE TABLE IF NOT EXISTS billing_webhook_events (
  provider varchar(12) NOT NULL CHECK (provider IN ('paystack', 'stripe')),
  event_id varchar(200) NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, event_id)
);

CREATE TABLE IF NOT EXISTS posting_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category varchar(20) NOT NULL CHECK (category IN ('jobs', 'products', 'marketplace', 'videos')),
  content_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category, content_id)
);

CREATE INDEX IF NOT EXISTS posting_usage_user_category_created_idx
  ON posting_usage(user_id, category, created_at DESC);

CREATE TABLE IF NOT EXISTS dating_billing_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(24) NOT NULL CHECK (code IN ('profile_boost', 'extra_likes')),
  name varchar(80) NOT NULL,
  currency varchar(3) NOT NULL CHECK (currency IN ('NGN', 'USD')),
  amount_minor bigint NOT NULL DEFAULT 0 CHECK (amount_minor >= 0),
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 1000),
  duration_hours integer NOT NULL DEFAULT 0 CHECK (duration_hours BETWEEN 0 AND 720),
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, currency)
);

CREATE TABLE IF NOT EXISTS dating_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES dating_billing_products(id) ON DELETE RESTRICT,
  transaction_id uuid NOT NULL REFERENCES billing_transactions(id) ON DELETE RESTRICT,
  quantity_remaining integer NOT NULL DEFAULT 0 CHECK (quantity_remaining >= 0),
  starts_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dating_entitlements_user_active_idx
  ON dating_entitlements(user_id, expires_at, quantity_remaining);

INSERT INTO subscription_plans (name, currency, amount_minor, posting_limits)
SELECT 'Publisher · 10 per category', 'NGN', 500000,
       '{"jobs":10,"products":10,"marketplace":10,"videos":10}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM subscription_plans WHERE name = 'Publisher · 10 per category' AND currency = 'NGN'
);

INSERT INTO subscription_plans (name, currency, amount_minor, posting_limits)
SELECT 'Publisher · 20 per category', 'NGN', 1000000,
       '{"jobs":20,"products":20,"marketplace":20,"videos":20}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM subscription_plans WHERE name = 'Publisher · 20 per category' AND currency = 'NGN'
);

INSERT INTO subscription_plans (name, currency, amount_minor, posting_limits)
SELECT 'Publisher · 10 per category', 'USD', 500,
       '{"jobs":10,"products":10,"marketplace":10,"videos":10}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM subscription_plans WHERE name = 'Publisher · 10 per category' AND currency = 'USD'
);

INSERT INTO subscription_plans (name, currency, amount_minor, posting_limits)
SELECT 'Publisher · 20 per category', 'USD', 1000,
       '{"jobs":20,"products":20,"marketplace":20,"videos":20}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM subscription_plans WHERE name = 'Publisher · 20 per category' AND currency = 'USD'
);

INSERT INTO dating_billing_products (code, name, currency, amount_minor, quantity, duration_hours)
VALUES
  ('profile_boost', 'Profile boost · 24 hours · NGN', 'NGN', 0, 1, 24),
  ('profile_boost', 'Profile boost · 24 hours · USD', 'USD', 0, 1, 24),
  ('extra_likes', '5 extra likes · NGN', 'NGN', 0, 5, 0),
  ('extra_likes', '5 extra likes · USD', 'USD', 0, 5, 0)
ON CONFLICT (code, currency) DO NOTHING;

CREATE TABLE IF NOT EXISTS ibook_stay_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  property_type varchar(24) NOT NULL
    CHECK (property_type IN ('Apartment', 'House', 'Room', 'Vacation rental')),
  title varchar(120) NOT NULL,
  location varchar(120) NOT NULL,
  price bigint NOT NULL CHECK (price > 0),
  price_unit varchar(8) NOT NULL CHECK (price_unit IN ('night', 'month')),
  max_guests smallint NOT NULL CHECK (max_guests BETWEEN 1 AND 30),
  description varchar(2000) NOT NULL,
  image_urls text[] NOT NULL CHECK (cardinality(image_urls) BETWEEN 1 AND 5),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ibook_stays_active_created_idx
  ON ibook_stay_listings(created_at DESC, id DESC)
  WHERE active;

CREATE INDEX IF NOT EXISTS ibook_stays_location_idx
  ON ibook_stay_listings(lower(location))
  WHERE active;

CREATE TABLE IF NOT EXISTS ibook_stay_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES ibook_stay_listings(id) ON DELETE RESTRICT,
  guest_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  check_in date NOT NULL,
  check_out date NOT NULL,
  guests smallint NOT NULL CHECK (guests BETWEEN 1 AND 30),
  message varchar(500) NOT NULL DEFAULT '',
  status varchar(12) NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'confirmed', 'declined', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (check_out > check_in)
);

CREATE INDEX IF NOT EXISTS ibook_stay_bookings_listing_dates_idx
  ON ibook_stay_bookings(listing_id, check_in, check_out)
  WHERE status = 'confirmed';

CREATE INDEX IF NOT EXISTS ibook_stay_bookings_guest_created_idx
  ON ibook_stay_bookings(guest_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ibook_driver_profiles (
  driver_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  vehicle_type varchar(12) NOT NULL
    CHECK (vehicle_type IN ('Car', 'Motorcycle', 'Tricycle')),
  vehicle_description varchar(100) NOT NULL,
  service_area varchar(120) NOT NULL,
  seats smallint NOT NULL CHECK (seats BETWEEN 1 AND 8),
  available boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ibook_drivers_available_area_idx
  ON ibook_driver_profiles(lower(service_area), updated_at DESC)
  WHERE available;

CREATE TABLE IF NOT EXISTS ibook_ride_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  driver_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  pickup varchar(180) NOT NULL,
  destination varchar(180) NOT NULL,
  pickup_time timestamptz NOT NULL,
  passengers smallint NOT NULL CHECK (passengers BETWEEN 1 AND 8),
  note varchar(500) NOT NULL DEFAULT '',
  status varchar(12) NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'accepted', 'declined', 'cancelled', 'completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (rider_id <> driver_id)
);

CREATE INDEX IF NOT EXISTS ibook_rides_rider_created_idx
  ON ibook_ride_requests(rider_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ibook_rides_driver_created_idx
  ON ibook_ride_requests(driver_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS ibook_one_active_ride_per_driver_idx
  ON ibook_ride_requests(driver_id)
  WHERE status = 'accepted';
