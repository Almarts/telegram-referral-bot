-- Drop the UNIQUE constraint on ref_code (nulls conflict)
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS users_ref_code_key;

-- Create a partial unique index that allows multiple NULLs
-- but still prevents duplicate non-null ref_codes
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_ref_code_unique
  ON "users" ("ref_code")
  WHERE "ref_code" IS NOT NULL;
