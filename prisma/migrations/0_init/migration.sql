-- ============================================================================
-- QUOTE-HUB DATABASE INITIALIZATION SCRIPT (POSTGRESQL 16+)
-- BASELINE MIGRATION: 0_init
-- ============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- 2. CUSTOM ENUM TYPES
CREATE TYPE user_role AS ENUM ('USER', 'ADMIN');
CREATE TYPE user_status AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');
CREATE TYPE notification_type AS ENUM ('LIKE', 'REPOST', 'FOLLOW');
CREATE TYPE outbox_status AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED');
CREATE TYPE idempotency_status AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- 3. TIMESTAMP UPDATE FUNCTION
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. BETTER AUTH TABLES (SEPARATED AUTHENTICATION SUBSYSTEM)
CREATE TABLE auth_user (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    email_verified BOOLEAN NOT NULL,
    image TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_auth_user_email UNIQUE (email)
);

CREATE TRIGGER trg_auth_user_updated_at
BEFORE UPDATE ON auth_user
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();

CREATE TABLE auth_session (
    id TEXT PRIMARY KEY,
    expires_at TIMESTAMPTZ NOT NULL,
    token TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ip_address TEXT NULL,
    user_agent TEXT NULL,
    user_id TEXT NOT NULL,

    CONSTRAINT uq_auth_session_token UNIQUE (token),
    CONSTRAINT fk_auth_session_user FOREIGN KEY (user_id) REFERENCES auth_user (id) ON DELETE CASCADE
);

CREATE TRIGGER trg_auth_session_updated_at
BEFORE UPDATE ON auth_session
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();

CREATE TABLE auth_account (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    access_token TEXT NULL,
    refresh_token TEXT NULL,
    id_token TEXT NULL,
    access_token_expires_at TIMESTAMPTZ NULL,
    refresh_token_expires_at TIMESTAMPTZ NULL,
    scope TEXT NULL,
    password TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_auth_account_user FOREIGN KEY (user_id) REFERENCES auth_user (id) ON DELETE CASCADE
);

CREATE TRIGGER trg_auth_account_updated_at
BEFORE UPDATE ON auth_account
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();

CREATE TABLE auth_verification (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NULL DEFAULT CURRENT_TIMESTAMP
);

-- 5. DOMAIN TABLE: users
CREATE TABLE users (
    id UUID PRIMARY KEY,
    auth_id TEXT NULL,
    username VARCHAR(30) NOT NULL,
    display_name VARCHAR(50) NOT NULL,
    bio VARCHAR(160) NULL,
    profile_image_url TEXT NULL,
    role user_role NOT NULL DEFAULT 'USER',
    status user_status NOT NULL DEFAULT 'ACTIVE',
    suspended_at TIMESTAMPTZ NULL,
    suspended_until TIMESTAMPTZ NULL,
    suspension_reason TEXT NULL,
    follower_count INTEGER NOT NULL DEFAULT 0,
    following_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ NULL,

    CONSTRAINT uq_users_auth_id UNIQUE (auth_id),
    CONSTRAINT fk_users_auth FOREIGN KEY (auth_id) REFERENCES auth_user (id) ON DELETE SET NULL,
    CONSTRAINT uq_users_username UNIQUE (username),
    CONSTRAINT chk_users_username_format CHECK (username ~ '^[a-zA-Z0-9_]{3,30}$'),
    CONSTRAINT chk_users_display_name_length CHECK (char_length(trim(display_name)) >= 1),
    CONSTRAINT chk_users_follower_count_non_negative CHECK (follower_count >= 0),
    CONSTRAINT chk_users_following_count_non_negative CHECK (following_count >= 0)
);

CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();

CREATE INDEX idx_users_status_created ON users (status, created_at DESC);
CREATE INDEX idx_users_username_trgm ON users USING gin (username gin_trgm_ops);
CREATE INDEX idx_users_display_name_trgm ON users USING gin (display_name gin_trgm_ops);

-- 6. DOMAIN TABLE: themes
CREATE TABLE themes (
    id UUID PRIMARY KEY,
    key VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_themes_key UNIQUE (key),
    CONSTRAINT chk_themes_key_format CHECK (key ~ '^[a-z0-9-]+$')
);

CREATE TRIGGER trg_themes_updated_at
BEFORE UPDATE ON themes
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();

-- 7. DOMAIN TABLE: quotes
CREATE TABLE quotes (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    text VARCHAR(280) NOT NULL,
    is_original BOOLEAN NOT NULL,
    author_name VARCHAR(100) NULL,
    theme_id UUID NOT NULL,
    like_count INTEGER NOT NULL DEFAULT 0,
    repost_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ NULL,

    CONSTRAINT fk_quotes_users FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT fk_quotes_themes FOREIGN KEY (theme_id) REFERENCES themes (id) ON DELETE RESTRICT,
    CONSTRAINT chk_quotes_text_length CHECK (char_length(trim(text)) >= 1 AND char_length(text) <= 280),
    CONSTRAINT chk_quotes_attribution_logic CHECK (
        (is_original = TRUE AND author_name IS NULL) OR
        (is_original = FALSE)
    ),
    CONSTRAINT chk_quotes_like_count_non_negative CHECK (like_count >= 0),
    CONSTRAINT chk_quotes_repost_count_non_negative CHECK (repost_count >= 0)
);

CREATE TRIGGER trg_quotes_updated_at
BEFORE UPDATE ON quotes
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();

CREATE INDEX idx_quotes_feed_cursor ON quotes (created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_quotes_user_created ON quotes (user_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_quotes_theme_id ON quotes (theme_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_quotes_text_trgm ON quotes USING gin (text gin_trgm_ops) WHERE deleted_at IS NULL;
CREATE INDEX idx_quotes_author_trgm ON quotes USING gin (author_name gin_trgm_ops) 
    WHERE deleted_at IS NULL AND author_name IS NOT NULL;

-- 8. DOMAIN TABLE: likes
CREATE TABLE likes (
    user_id UUID NOT NULL,
    quote_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (user_id, quote_id),
    CONSTRAINT fk_likes_users FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_likes_quotes FOREIGN KEY (quote_id) REFERENCES quotes (id) ON DELETE CASCADE
);

CREATE INDEX idx_likes_quote_id ON likes (quote_id);
CREATE INDEX idx_likes_user_created ON likes (user_id, created_at DESC);

-- 9. DOMAIN TABLE: reposts
CREATE TABLE reposts (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    quote_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_reposts_user_quote UNIQUE (user_id, quote_id),
    CONSTRAINT fk_reposts_users FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_reposts_quotes FOREIGN KEY (quote_id) REFERENCES quotes (id) ON DELETE CASCADE
);

CREATE INDEX idx_reposts_user_created ON reposts (user_id, created_at DESC);
CREATE INDEX idx_reposts_quote_created ON reposts (quote_id, created_at DESC);

-- 10. DOMAIN TABLE: bookmarks
CREATE TABLE bookmarks (
    user_id UUID NOT NULL,
    quote_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (user_id, quote_id),
    CONSTRAINT fk_bookmarks_users FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_bookmarks_quotes FOREIGN KEY (quote_id) REFERENCES quotes (id) ON DELETE CASCADE
);

CREATE INDEX idx_bookmarks_user_created ON bookmarks (user_id, created_at DESC);

-- 11. DOMAIN TABLE: follows
CREATE TABLE follows (
    follower_id UUID NOT NULL,
    following_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (follower_id, following_id),
    CONSTRAINT fk_follows_follower FOREIGN KEY (follower_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_follows_following FOREIGN KEY (following_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT chk_follows_no_self_follow CHECK (follower_id <> following_id)
);

CREATE INDEX idx_follows_following_created ON follows (following_id, created_at DESC);
CREATE INDEX idx_follows_follower_created ON follows (follower_id, created_at DESC);

-- 12. DOMAIN TABLE: notifications
CREATE TABLE notifications (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    actor_id UUID NOT NULL,
    type notification_type NOT NULL,
    entity_id UUID NOT NULL,
    read_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_notifications_actor FOREIGN KEY (actor_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX idx_notifications_user_created ON notifications (user_id, created_at DESC);
CREATE INDEX idx_notifications_user_unread ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;

-- 13. DOMAIN TABLE: outbox_events
CREATE TABLE outbox_events (
    id UUID PRIMARY KEY,
    event_type VARCHAR(100) NOT NULL,
    aggregate_type VARCHAR(50) NOT NULL,
    aggregate_id UUID NOT NULL,
    payload JSONB NOT NULL,
    status outbox_status NOT NULL DEFAULT 'PENDING',
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT NULL,
    scheduled_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_outbox_retry_non_negative CHECK (retry_count >= 0)
);

CREATE INDEX idx_outbox_pending_polling ON outbox_events (scheduled_at, created_at) WHERE status = 'PENDING';

-- 14. DOMAIN TABLE: idempotency_keys
CREATE TABLE idempotency_keys (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    key VARCHAR(255) NOT NULL,
    endpoint VARCHAR(255) NOT NULL,
    request_hash CHAR(64) NOT NULL,
    status idempotency_status NOT NULL DEFAULT 'PENDING',
    response_status SMALLINT NULL,
    response_body JSONB NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL,

    CONSTRAINT uq_idempotency_user_key_ep UNIQUE (user_id, key, endpoint),
    CONSTRAINT fk_idempotency_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX idx_idempotency_expires_at ON idempotency_keys (expires_at);

-- 15. DOMAIN TABLE: audit_logs
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY,
    actor_user_id UUID NOT NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id VARCHAR(255) NOT NULL,
    metadata JSONB NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_audit_logs_actor FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE RESTRICT
);

CREATE INDEX idx_audit_logs_actor_created ON audit_logs (actor_user_id, created_at DESC);
CREATE INDEX idx_audit_logs_resource ON audit_logs (resource_type, resource_id);

-- 16. DOMAIN TABLE: daily_metrics
CREATE TABLE daily_metrics (
    metric_date DATE PRIMARY KEY,
    registered_users INTEGER NOT NULL DEFAULT 0,
    active_users INTEGER NOT NULL DEFAULT 0,
    quotes_created INTEGER NOT NULL DEFAULT 0,
    likes_created INTEGER NOT NULL DEFAULT 0,
    reposts_created INTEGER NOT NULL DEFAULT 0,
    bookmarks_created INTEGER NOT NULL DEFAULT 0,
    follows_created INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_daily_metrics_registered CHECK (registered_users >= 0),
    CONSTRAINT chk_daily_metrics_active CHECK (active_users >= 0),
    CONSTRAINT chk_daily_metrics_quotes CHECK (quotes_created >= 0),
    CONSTRAINT chk_daily_metrics_likes CHECK (likes_created >= 0),
    CONSTRAINT chk_daily_metrics_reposts CHECK (reposts_created >= 0),
    CONSTRAINT chk_daily_metrics_bookmarks CHECK (bookmarks_created >= 0),
    CONSTRAINT chk_daily_metrics_follows CHECK (follows_created >= 0)
);

CREATE TRIGGER trg_daily_metrics_updated_at
BEFORE UPDATE ON daily_metrics
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();
