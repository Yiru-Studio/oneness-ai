import { Prisma } from '@prisma/client';
import { getPrismaClient } from '@oneness/shared/prisma';
import {
  buildSceneImageCompositionPrompt,
  cleanSceneImageSummary,
  type EpisodeScene,
} from '../src/lib/composition-ai-planning.js';

type Args = {
  projectId: string | null;
  apply: boolean;
};

type SceneJson = {
  index?: unknown;
  title?: unknown;
  content?: unknown;
  characters?: unknown;
  environment?: unknown;
};

const prisma = getPrismaClient();

const args = parseArgs(process.argv.slice(2));
if (!args.projectId) {
  console.error('Usage: pnpm --filter api exec tsx scripts/repair-composition-task-excerpts.ts --projectId <id> [--apply]');
  process.exit(1);
}

const tasks = await prisma.compositionTask.findMany({
  where: { projectId: args.projectId },
  include: {
    episode: { select: { number: true, title: true, scenesJson: true } },
  },
  orderBy: [{ episode: { number: 'asc' } }, { sceneIndex: 'asc' }],
});

const project = await prisma.project.findUnique({
  where: { id: args.projectId },
  select: { ratio: true, stylePrompt: true },
});

if (!project) {
  console.error(`Project not found: ${args.projectId}`);
  process.exit(1);
}

for (const task of tasks) {
  const episodeScene = findEpisodeScene(task.episode.scenesJson, task.sceneIndex);
  const summarySource = episodeScene?.content || task.scriptExcerpt;
  const summary = cleanSceneImageSummary(summarySource);
  const scene: EpisodeScene = {
    index: task.sceneIndex,
    title: stripEpisodePrefix(task.title),
    content: summary,
    characters: episodeScene?.characters ?? [],
    environment: episodeScene?.environment ?? '',
  };
  const refs = {
    characterStyleIds: jsonStringArray(task.characterStyleIds),
    sceneIds: jsonStringArray(task.sceneIds),
    itemIds: jsonStringArray(task.itemIds),
  };
  const prompt = buildSceneImageCompositionPrompt(project, scene, refs);
  const changed = task.scriptExcerpt !== summary || task.prompt !== prompt;

  console.log([
    changed ? '[change]' : '[same]',
    `scene=${task.sceneIndex + 1}`,
    `title=${task.title}`,
    `beforeLen=${task.scriptExcerpt.length}`,
    `afterLen=${summary.length}`,
    `after=${summary}`,
  ].join(' | '));

  if (args.apply && changed) {
    await prisma.compositionTask.update({
      where: { id: task.id },
      data: { scriptExcerpt: summary, prompt },
    });
  }
}

await prisma.$disconnect();

function parseArgs(values: string[]): Args {
  let projectId: string | null = null;
  let apply = false;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value === '--apply') apply = true;
    if (value === '--projectId') {
      projectId = values[i + 1] ?? null;
      i += 1;
    }
  }
  return { projectId, apply };
}

function findEpisodeScene(scenesJson: Prisma.JsonValue, sceneIndex: number): EpisodeScene | null {
  if (!Array.isArray(scenesJson)) return null;
  const raw = scenesJson.find((item, fallbackIndex) => {
    if (!item || typeof item !== 'object') return fallbackIndex === sceneIndex;
    const index = (item as SceneJson).index;
    return (typeof index === 'number' ? index : fallbackIndex) === sceneIndex;
  });
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as SceneJson;
  return {
    index: typeof obj.index === 'number' ? obj.index : sceneIndex,
    title: text(obj.title),
    content: text(obj.content),
    characters: Array.isArray(obj.characters)
      ? obj.characters.filter((item): item is string => typeof item === 'string')
      : [],
    environment: text(obj.environment),
  };
}

function jsonStringArray(value: Prisma.JsonValue): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function stripEpisodePrefix(title: string): string {
  return title.replace(/^第\d+集\s*·\s*/u, '').trim() || title;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
