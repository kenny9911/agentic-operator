-- P2-FE-18 — surface "test runs" as a first-class run attribute.
--
-- The Agents detail header's "Test run" button calls
--   POST /v1/agents/:name/invoke?testRun=1
-- which records the run with `is_test = 1`. The dashboard active-runs strip
-- and the runs list/detail render a TEST badge for these rows.
--
-- Column is non-null with a 0 default so back-filling is a no-op (every
-- existing run is implicitly a non-test run). A partial index on
-- `is_test = 1` keeps the rare "give me only test runs" filter cheap
-- without paying for the index on the dominant non-test rows.
ALTER TABLE `runs` ADD `is_test` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `runs_is_test_idx` ON `runs` (`is_test`) WHERE `is_test` = 1;
