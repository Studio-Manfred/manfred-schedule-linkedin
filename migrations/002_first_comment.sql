-- Optional auto-posted first comment (best used for external links, which
-- LinkedIn suppresses in the post body). Sent to Zernio as
-- platformSpecificData.firstComment. NULL / blank means "no first comment".
ALTER TABLE posts ADD COLUMN IF NOT EXISTS first_comment text;
