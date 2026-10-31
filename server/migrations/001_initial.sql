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
  body varchar(280) NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 280),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS social_post_comments_created_at_idx
  ON social_post_comments(post_id, created_at);

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

CREATE TABLE IF NOT EXISTS direct_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES direct_conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body varchar(2000) NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  CONSTRAINT direct_messages_distinct_participants CHECK (sender_id <> recipient_id)
);

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
  created_at timestamptz NOT NULL DEFAULT now()
);

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
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_listings_created_at_idx
  ON job_listings(created_at DESC, id DESC);

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
