-- Document extended user statuses for self-signup approval flow.
-- users.status remains unconstrained text; application values:
--   active | disabled | invited | pending_email | pending_approval
-- auth_tokens.purpose may also be: email_confirm (in addition to password_reset, invite)
SELECT 1;
