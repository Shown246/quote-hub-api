/**
 * Type of feed item activity in the unified feed stream.
 */
export type FeedItemType = "ORIGINAL_QUOTE" | "REPOST";

/**
 * Representation of the actor responsible for the feed event.
 * For an ORIGINAL_QUOTE, this is the author who posted the quote.
 * For a REPOST, this is the user who reposted the quote.
 */
export interface FeedActor {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  profileImageUrl?: string | null;
}

/**
 * Representation of the author who originally created the quote.
 */
export interface FeedAuthor {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  profileImageUrl?: string | null;
}

/**
 * Canonical quote content payload attached to a feed item.
 */
export interface FeedQuote {
  id: string;
  text: string;
  isOriginal: boolean;
  authorName: string | null;
  likeCount: number;
  repostCount: number;
  createdAt: Date;
  themeKey?: string;
  author: FeedAuthor;
}

/**
 * Unified representation of a feed item conforming to Section 45
 * of the Technical Design Document.
 */
export interface FeedItem {
  type: FeedItemType;
  actor: FeedActor;
  quote: FeedQuote;
  createdAt: Date;
}

/**
 * Standard paginated response for feed endpoints.
 */
export interface FeedResponse {
  items: FeedItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Alias for feed query results returned by repositories and services.
 */
export type FollowingFeedResult = FeedResponse;

/**
 * Raw SQL row returned by the Following Feed query defined in
 * Section 9.1 of the Database Design Document.
 */
export interface FeedCandidateRawRow {
  feed_item_type: "ORIGINAL_QUOTE" | "REPOST";
  actor_id: string;
  event_time: Date | string;
  tiebreaker_id: string;
  quote_id?: string;
  id?: string;
  text: string;
  is_original: boolean;
  author_name: string | null;
  like_count: number | bigint;
  repost_count: number | bigint;
  created_at: Date | string;
  author_id: string;
  author_username: string;
  author_display_name: string;
  author_avatar_url: string | null;
  actor_username?: string | null;
  actor_display_name?: string | null;
  actor_avatar_url?: string | null;
  theme_key?: string | null;
}
