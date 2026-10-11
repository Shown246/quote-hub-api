CREATE OR REPLACE PROCEDURE reconcile_all_counters()
LANGUAGE plpgsql AS $$
BEGIN
    -- 1. Reconcile Quote like_count
    UPDATE quotes q
    SET like_count = COALESCE(l.computed_likes, 0)
    FROM (
        SELECT quote_id, COUNT(*) AS computed_likes
        FROM likes
        GROUP BY quote_id
    ) l
    WHERE q.id = l.quote_id AND q.like_count <> l.computed_likes;

    UPDATE quotes q
    SET like_count = 0
    WHERE q.id NOT IN (SELECT quote_id FROM likes) AND q.like_count <> 0;

    -- 2. Reconcile Quote repost_count
    UPDATE quotes q
    SET repost_count = COALESCE(r.computed_reposts, 0)
    FROM (
        SELECT quote_id, COUNT(*) AS computed_reposts
        FROM reposts
        GROUP BY quote_id
    ) r
    WHERE q.id = r.quote_id AND q.repost_count <> r.computed_reposts;

    UPDATE quotes q
    SET repost_count = 0
    WHERE q.id NOT IN (SELECT quote_id FROM reposts) AND q.repost_count <> 0;

    -- 3. Reconcile User follower_count
    UPDATE users u
    SET follower_count = COALESCE(f.computed_followers, 0)
    FROM (
        SELECT following_id, COUNT(*) AS computed_followers
        FROM follows
        GROUP BY following_id
    ) f
    WHERE u.id = f.following_id AND u.follower_count <> f.computed_followers;

    UPDATE users u
    SET follower_count = 0
    WHERE u.id NOT IN (SELECT following_id FROM follows) AND u.follower_count <> 0;

    -- 4. Reconcile User following_count
    UPDATE users u
    SET following_count = COALESCE(f.computed_following, 0)
    FROM (
        SELECT follower_id, COUNT(*) AS computed_following
        FROM follows
        GROUP BY follower_id
    ) f
    WHERE u.id = f.follower_id AND u.following_count <> f.computed_following;

    UPDATE users u
    SET following_count = 0
    WHERE u.id NOT IN (SELECT follower_id FROM follows) AND u.following_count <> 0;
END;
$$;
