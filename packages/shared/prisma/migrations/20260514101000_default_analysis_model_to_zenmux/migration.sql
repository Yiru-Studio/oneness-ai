-- Backfill legacy analysisModel display-names ('Doubao 2.0', 'Gemini 3 Pro' …)
-- with a real zenmux model id so the worker's openai-text provider can call it.
UPDATE "Project"
SET "analysisModel" = 'anthropic/claude-sonnet-4.6'
WHERE "analysisModel" NOT LIKE '%/%';
