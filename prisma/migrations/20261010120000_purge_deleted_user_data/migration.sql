-- Asynchronous User Deletion Cleanup Procedure (Database Design Document § 10.2)
CREATE OR REPLACE PROCEDURE purge_deleted_user_data(target_user_id UUID)
LANGUAGE plpgsql AS $$
BEGIN
    -- 1. Remove all interaction edges created by the user
    DELETE FROM likes WHERE user_id = target_user_id;
    DELETE FROM reposts WHERE user_id = target_user_id;
    DELETE FROM bookmarks WHERE user_id = target_user_id;

    -- 2. Remove outbound and inbound social follow edges
    DELETE FROM follows WHERE follower_id = target_user_id OR following_id = target_user_id;

    -- 3. Soft-delete all quotes owned by the user
    UPDATE quotes 
    SET deleted_at = CURRENT_TIMESTAMP 
    WHERE user_id = target_user_id AND deleted_at IS NULL;

    -- 4. Purge unread notifications
    DELETE FROM notifications WHERE user_id = target_user_id;
END;
$$;
