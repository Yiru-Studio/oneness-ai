-- Add markedBlank flag to Character. Set TRUE when user clicks "创建为空白角色"
-- skipping the AI-driven 分析角色 path.
ALTER TABLE "Character" ADD COLUMN "markedBlank" BOOLEAN NOT NULL DEFAULT false;
