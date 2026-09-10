-- PostgreSQL owns accounts, credentials, reviews and sessions. These columns
-- only associate the existing runtime/audit principal with its immutable account.
ALTER TABLE users ADD authority_account_id text;
--> statement-breakpoint
ALTER TABLE users ADD authority_username text;
--> statement-breakpoint
CREATE UNIQUE INDEX users_authority_account_uq ON users(authority_account_id);
--> statement-breakpoint
DROP INDEX users_email_uq;
--> statement-breakpoint
-- Username-only accounts have no email; the legacy non-null string uses ''.
-- They never authenticate or link by email. Legacy email uniqueness is retained.
CREATE UNIQUE INDEX users_email_uq ON users(email) WHERE authority_account_id IS NULL;
