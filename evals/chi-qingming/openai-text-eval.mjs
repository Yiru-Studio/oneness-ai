import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildReferenceBindingMessages,
  completeReferenceBindingForScene,
  filterReferenceBindingForScene,
  buildSceneImagePlanningMessages,
  normalizeSceneImagePlans,
  parseSceneImagePlanResponse,
  parseSceneImageReferenceBindingResponse,
  prefillCompositionReferences,
  referenceLibraryIdSets,
  sanitizeReferenceBinding,
} from '../../packages/shared/src/composition-planning.ts';
import {
  buildCharacterAnalysisMessages,
  normalizeCharacterAnalysis,
  parseCharacterAnalysisJson,
  stripCharacterStyleMetadataForGeneration,
} from '../../packages/shared/src/character-analysis.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
loadEnvFile(path.join(repoRoot, '.env'));

const fixtureRoot = path.join(repoRoot, 'evals/fixtures/chi_qingming');
const outputDir = path.join(repoRoot, 'evals/outputs');
const dataset = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'data/chi_qingming.calibrated.dataset.json'), 'utf8'));
const fullReport = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'reports/chi_qingming.edit_shots_full_report.json'), 'utf8'));

const apiKey = process.env.OPENAI_API_KEY;
const baseURL = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
const model = process.env.OPENAI_TEXT_EVAL_MODEL ?? process.env.OPENAI_TEXT_MODEL ?? 'gpt-4o-mini';
const rounds = intEnv('OPENAI_TEXT_EVAL_ROUNDS', 3);
const sceneLimit = intEnv('OPENAI_TEXT_EVAL_SCENES', 3);
const characterLimit = intEnv('OPENAI_TEXT_EVAL_CHARACTERS', 2);
const requestRetries = intEnv('OPENAI_TEXT_EVAL_REQUEST_RETRIES', 4);
const retryBaseDelayMs = intEnv('OPENAI_TEXT_EVAL_RETRY_BASE_MS', 2000);

if (!apiKey) {
  console.error('OPENAI_API_KEY is not set. Refusing to run real OpenAI text eval.');
  process.exit(1);
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function intEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function sceneText(scene) {
  return scene.raw_paragraphs?.map((item) => item.text).join('\n') || scene.summary || '';
}

function makeReferenceLibrary(data) {
  const characterAssets = data.assets.filter((asset) => asset.group === '角色');
  const sceneAssets = data.assets.filter((asset) => asset.group === '场景');
  const itemAssets = data.assets.filter((asset) => asset.group === '道具');
  return {
    characters: characterAssets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      description: asset.description || '',
      bio: asset.description || '',
      styles: [
        {
          id: `${asset.id}__style__default`,
          name: '默认造型',
          prompt: asset.calibrated_generation_reference_prompt || asset.generation_reference_prompt || asset.description || '',
          assetId: null,
        },
        {
          id: `${asset.id}__style__scene_specific`,
          name: `${asset.name}剧情造型`,
          prompt: `${asset.description || ''}\n${asset.generation_reference_prompt || ''}`,
          assetId: `${asset.id}__mock_asset`,
        },
      ],
    })),
    scenes: sceneAssets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      description: asset.description || '',
      prompt: asset.calibrated_generation_reference_prompt || asset.generation_reference_prompt || '',
      assetId: null,
    })),
    items: itemAssets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      description: asset.description || '',
      prompt: asset.calibrated_generation_reference_prompt || asset.generation_reference_prompt || '',
      assetId: null,
    })),
  };
}

const library = makeReferenceLibrary(dataset);
const fullReportItemsByScene = new Map();
for (const item of fullReport.items) {
  const arr = fullReportItemsByScene.get(item.scene_number) ?? [];
  arr.push(item);
  fullReportItemsByScene.set(item.scene_number, arr);
}

const criticalSceneNumbers = ['1', '3', '5', '8'];
const selectedScriptScenes = unique([
  ...criticalSceneNumbers,
  ...dataset.script_scenes.map((scene) => scene.scene_number),
])
  .map((sceneNumber) => dataset.script_scenes.find((scene) => scene.scene_number === sceneNumber))
  .filter(Boolean)
  .slice(0, sceneLimit);

const selectedCharacters = ['吴一杰', '池清明', '中年女声', '闫老师']
  .map((name) => dataset.assets.find((asset) => asset.group === '角色' && asset.name === name))
  .filter(Boolean)
  .slice(0, characterLimit);

function expectedForScene(scene) {
  const reportItems = fullReportItemsByScene.get(scene.scene_number) ?? [];
  return {
    visibleCharacters: unique(reportItems.flatMap((item) => item.characters)),
    filteredCharacters: unique(reportItems.flatMap((item) => item.filtered_characters ?? [])),
    visibleItems: unique(reportItems.flatMap((item) => item.props)),
    filteredItems: unique(reportItems.flatMap((item) => item.filtered_props ?? [])),
  };
}

function fallbackEpisodeScene(scene) {
  const expected = expectedForScene(scene);
  const rawCharacters = scene.characters ?? [];
  const rawItems = scene.props ?? [];
  return {
    index: Number.parseInt(String(scene.scene_number).replace(/\D/g, ''), 10) - 1 || 0,
    title: scene.heading,
    content: sceneText(scene),
    characters: rawCharacters,
    environment: scene.location,
    requiredReferences: {
      characters: rawCharacters,
      scenes: [scene.location, scene.heading],
      items: rawItems,
    },
    sceneReferences: {
      visibleCharacters: expected.visibleCharacters,
      mentionedCharacters: unique(rawCharacters.filter((name) => !expected.visibleCharacters.includes(name))),
      voiceCharacters: unique(rawCharacters.filter((name) => /声|旁白|广播/u.test(name))),
      backgroundCharacters: [],
      visibleItems: expected.visibleItems,
      mentionedItems: unique(rawItems.filter((name) => !expected.visibleItems.includes(name))),
      backgroundItems: [],
    },
  };
}

async function requestJson({ systemPrompt, userPrompt, tag }) {
  let lastError;
  for (let attempt = 1; attempt <= requestRetries; attempt += 1) {
    try {
      return await requestJsonOnce({ systemPrompt, userPrompt, tag });
    } catch (err) {
      lastError = err;
      if (attempt >= requestRetries || !isRetryableRequestError(err)) break;
      const delayMs = retryDelayMs(attempt);
      console.warn(`[${tag}] retry ${attempt}/${requestRetries - 1} after ${delayMs}ms: ${err instanceof Error ? err.message : String(err)}`);
      await sleep(delayMs);
    }
  }
  throw lastError;
}

async function requestJsonOnce({ systemPrompt, userPrompt, tag }) {
  const startedAt = Date.now();
  const res = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
    }),
  });
  const body = await res.text();
  const latencyMs = Date.now() - startedAt;
  if (!res.ok) {
    const error = new Error(`${tag} HTTP ${res.status}: ${body.slice(0, 500)}`);
    error.status = res.status;
    throw error;
  }
  const json = JSON.parse(body);
  return {
    raw: json.choices?.[0]?.message?.content ?? '',
    usage: json.usage ?? null,
    id: json.id ?? null,
    latencyMs,
  };
}

function isRetryableRequestError(err) {
  const message = err instanceof Error ? err.message : String(err);
  const status = typeof err?.status === 'number' ? err.status : null;
  return (
    status === 429 ||
    (status !== null && status >= 500) ||
    /ETIMEDOUT|ECONNRESET|EAI_AGAIN|fetch failed|timeout|upstream|socket|network/i.test(message)
  );
}

function retryDelayMs(attempt) {
  const exponential = retryBaseDelayMs * 2 ** Math.max(0, attempt - 1);
  const jitter = Math.floor(Math.random() * retryBaseDelayMs);
  return Math.min(30000, exponential + jitter);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function leakReport(selected, expectedVisible, expectedFiltered, group) {
  const selectedItems = selected.map((name) => ({ name, asset: findReferenceAsset(name, group) }));
  return {
    missingVisible: expectedVisible.filter((name) => !selectedIncludesExpected(selected, name, group)),
    missingVisibleWithAsset: expectedVisible.filter((name) => {
      const asset = findReferenceAsset(name, group);
      return asset && !selectedItems.some((item) => item.asset?.id === asset.id);
    }),
    leakedFiltered: expectedFiltered.filter((name) => selectedIncludesExpected(selected, name, group)),
    extraUnknown: selected.filter((name) => (
      !expectedVisible.some((expected) => sameReferenceAsset(name, expected, group)) &&
      !expectedFiltered.some((expected) => sameReferenceAsset(name, expected, group))
    )),
  };
}

function selectedIncludesExpected(selected, expectedName, group) {
  if (selected.includes(expectedName)) return true;
  const expectedAsset = findReferenceAsset(expectedName, group);
  if (!expectedAsset) return false;
  return selected.some((name) => findReferenceAsset(name, group)?.id === expectedAsset.id);
}

function sameReferenceAsset(left, right, group) {
  if (left === right || left.includes(right) || right.includes(left)) return true;
  const leftAsset = findReferenceAsset(left, group);
  const rightAsset = findReferenceAsset(right, group);
  return Boolean(leftAsset && rightAsset && leftAsset.id === rightAsset.id);
}

function findReferenceAsset(name, group) {
  return dataset.assets.find((asset) => asset.group === group && (
    asset.name === name ||
    name.includes(asset.name) ||
    asset.name.includes(name) ||
    (group !== '角色' && textMatchesAsset(name, asset))
  ));
}

function textMatchesAsset(text, asset) {
  const haystack = [asset.name, asset.description, asset.generation_reference_prompt, asset.calibrated_generation_reference_prompt]
    .filter(Boolean)
    .join('\n');
  return haystack.includes(text) || text.includes(asset.name);
}

function refsToNames(refs) {
  return {
    characters: refs.characterStyleIds
      .map((id) => library.characters.find((character) => character.styles.some((style) => style.id === id))?.name)
      .filter(Boolean),
    scenes: refs.sceneIds.map((id) => library.scenes.find((scene) => scene.id === id)?.name).filter(Boolean),
    items: refs.itemIds.map((id) => library.items.find((item) => item.id === id)?.name).filter(Boolean),
  };
}

function expectedForEpisodeScene(scene) {
  if (!scene) {
    return { visibleCharacters: [], filteredCharacters: [], visibleItems: [], filteredItems: [] };
  }
  if (scene.sceneReferences) {
    return {
      visibleCharacters: unique([
        ...(scene.sceneReferences.visibleCharacters ?? []),
        ...(scene.sceneReferences.backgroundCharacters ?? []),
      ]),
      filteredCharacters: unique([
        ...(scene.sceneReferences.mentionedCharacters ?? []),
        ...(scene.sceneReferences.voiceCharacters ?? []),
      ]),
      visibleItems: unique([
        ...(scene.sceneReferences.visibleItems ?? []),
        ...(scene.sceneReferences.backgroundItems ?? []),
      ]),
      filteredItems: unique(scene.sceneReferences.mentionedItems ?? []),
    };
  }
  const scriptScene = selectedScriptScenes.find((item) => fallbackEpisodeScene(item).index === scene.index);
  return scriptScene ? expectedForScene(scriptScene) : {
    visibleCharacters: scene.characters ?? [],
    filteredCharacters: [],
    visibleItems: scene.requiredReferences?.items ?? [],
    filteredItems: [],
  };
}

async function evalScenePlanning(round) {
  const episodeContent = selectedScriptScenes.map((scene) => `${scene.heading}\n${sceneText(scene)}`).join('\n\n---\n\n');
  const fallbackScenes = selectedScriptScenes.map(fallbackEpisodeScene);
  const { systemPrompt, userPrompt } = buildSceneImagePlanningMessages({
    project: { ratio: '16:9', stylePrompt: dataset.filmforge_mapping?.project?.settings?.visualStyle || '写实电影感' },
    episode: { number: 1, title: dataset.title ?? '池清明到底是谁', content: episodeContent },
  });
  const response = await requestJson({ systemPrompt, userPrompt, tag: `scene-planning-${round}` });
  const parsedPlans = parseSceneImagePlanResponse(response.raw);
  const scenes = normalizeSceneImagePlans(parsedPlans, fallbackScenes);
  return {
    round,
    id: response.id,
    latencyMs: response.latencyMs,
    usage: response.usage,
    parseOk: parsedPlans.length > 0,
    planCount: parsedPlans.length,
    normalizedCount: scenes.length,
    sceneReferenceCompleteness: scenes.map((scene) => ({
      sceneIndex: scene.index,
      title: scene.title,
      hasSceneReferences: Boolean(scene.sceneReferences),
      visibleCharacters: scene.sceneReferences?.visibleCharacters ?? [],
      voiceCharacters: scene.sceneReferences?.voiceCharacters ?? [],
      mentionedCharacters: scene.sceneReferences?.mentionedCharacters ?? [],
      visibleItems: scene.sceneReferences?.visibleItems ?? [],
      mentionedItems: scene.sceneReferences?.mentionedItems ?? [],
    })),
    rawPreview: response.raw.slice(0, 1200),
    scenes,
  };
}

async function evalReferenceBinding(round, scenes) {
  const usableScenes = scenes.length > 0 ? scenes : selectedScriptScenes.map(fallbackEpisodeScene);
  const { systemPrompt, userPrompt } = buildReferenceBindingMessages({
    project: { ratio: '16:9', stylePrompt: dataset.filmforge_mapping?.project?.settings?.visualStyle || '写实电影感' },
    episode: { number: 1, title: dataset.title ?? '池清明到底是谁' },
    scenes: usableScenes,
    library,
  });
  const response = await requestJson({ systemPrompt, userPrompt, tag: `reference-binding-${round}` });
  const validIds = referenceLibraryIdSets(library);
  const scenesByIndex = new Map(usableScenes.map((scene) => [scene.index, scene]));
  const parsed = parseSceneImageReferenceBindingResponse(response.raw);
  const rows = parsed.map((binding) => {
    const rawRefs = sanitizeReferenceBinding(binding, validIds);
    const scene = scenesByIndex.get(binding.sceneIndex);
    const filteredRefs = scene ? filterReferenceBindingForScene(rawRefs, scene, library) : rawRefs;
    const refs = scene ? completeReferenceBindingForScene(rawRefs, scene, library) : filteredRefs;
    const rawNames = refsToNames(rawRefs);
    const filteredNames = refsToNames(filteredRefs);
    const names = refsToNames(refs);
    const expected = expectedForEpisodeScene(scene);
    return {
      sceneIndex: binding.sceneIndex,
      rawRefs,
      rawNames,
      rawCharacterLeaks: leakReport(rawNames.characters, expected.visibleCharacters, expected.filteredCharacters, '角色'),
      rawItemLeaks: leakReport(rawNames.items, expected.visibleItems, expected.filteredItems, '道具'),
      filteredRefs,
      filteredNames,
      filteredCharacterLeaks: leakReport(filteredNames.characters, expected.visibleCharacters, expected.filteredCharacters, '角色'),
      filteredItemLeaks: leakReport(filteredNames.items, expected.visibleItems, expected.filteredItems, '道具'),
      refs,
      names,
      characterLeaks: leakReport(names.characters, expected.visibleCharacters, expected.filteredCharacters, '角色'),
      itemLeaks: leakReport(names.items, expected.visibleItems, expected.filteredItems, '道具'),
    };
  });
  const fallbackRows = usableScenes.map((scene) => ({
    sceneIndex: scene.index,
    refs: prefillCompositionReferences(scene, library),
  }));
  return {
    round,
    id: response.id,
    latencyMs: response.latencyMs,
    usage: response.usage,
    parseOk: parsed.length > 0,
    bindingCount: parsed.length,
    rows,
    fallbackRows,
    rawPreview: response.raw.slice(0, 1200),
  };
}

async function evalCharacterDetail(round, asset) {
  const scriptText = selectedScriptScenes.map((scene) => `${scene.heading}\n${sceneText(scene)}`).join('\n\n---\n\n');
  const { systemPrompt, userPrompt } = messagesObject(buildCharacterAnalysisMessages({
    characterName: asset.name,
    existingDescription: asset.description ?? '',
    scriptText,
    projectStylePrompt: dataset.filmforge_mapping?.project?.settings?.visualStyle || '写实电影感',
  }));
  const response = await requestJson({ systemPrompt, userPrompt, tag: `character-detail-${round}-${asset.name}` });
  let parsed;
  let normalized;
  let error = null;
  try {
    parsed = parseCharacterAnalysisJson(response.raw);
    normalized = normalizeCharacterAnalysis({
      characterName: asset.name,
      existingDescription: asset.description ?? '',
      projectStylePrompt: dataset.filmforge_mapping?.project?.settings?.visualStyle || '写实电影感',
      parsed,
    });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  return {
    round,
    characterName: asset.name,
    id: response.id,
    latencyMs: response.latencyMs,
    usage: response.usage,
    parseOk: !error,
    error,
    styleCount: normalized?.styles.length ?? 0,
    metadataCount: normalized?.styles.filter((style) => style.prompt.includes('造型元数据：')).length ?? 0,
    promptPollutionRows: normalized?.styles
      .map((style) => {
        const prompt = stripCharacterStyleMetadataForGeneration(style.prompt);
        return {
          name: style.name,
          prompt,
          positivePrompt: positiveCharacterPromptText(prompt),
        };
      })
      .filter((style) => /街道|房间|球场|教室|手持|拿着|互动/u.test(style.positivePrompt)) ?? [],
    rawPreview: response.raw.slice(0, 1200),
  };
}

function positiveCharacterPromptText(prompt) {
  return prompt
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(造型名称|类型|要求|身份锁定|背景|禁止|风格)：/.test(line))
    .filter((line) => !/^(角色参考图只画|固定穿戴|如果原描述|不要画)/.test(line))
    .join('\n');
}

function messagesObject(messages) {
  return {
    systemPrompt: messages.find((message) => message.role === 'system')?.content ?? '',
    userPrompt: messages.find((message) => message.role === 'user')?.content ?? '',
  };
}

function summarize(results) {
  const sceneRuns = results.scenePlanning;
  const bindingRuns = results.referenceBinding;
  const characterRuns = results.characterDetail;
  const allBindingRows = bindingRuns.flatMap((run) => run.rows);
  return {
    config: {
      baseURL,
      model,
      rounds,
      sceneLimit,
      characterLimit,
      imageCalls: 0,
      videoCalls: 0,
    },
    scenePlanning: {
      runs: sceneRuns.length,
      parseRate: rate(sceneRuns, (run) => run.parseOk),
      averagePlanCount: avg(sceneRuns.map((run) => run.planCount)),
      missingSceneReferences: sceneRuns.flatMap((run) =>
        run.sceneReferenceCompleteness.filter((scene) => !scene.hasSceneReferences).map((scene) => ({ round: run.round, sceneIndex: scene.sceneIndex, title: scene.title })),
      ),
    },
    referenceBinding: {
      runs: bindingRuns.length,
      parseRate: rate(bindingRuns, (run) => run.parseOk),
      rawCharacterLeakRows: allBindingRows.filter((row) => row.rawCharacterLeaks.leakedFiltered.length > 0),
      rawItemLeakRows: allBindingRows.filter((row) => row.rawItemLeaks.leakedFiltered.length > 0),
      rawMissingVisibleCharacterRows: allBindingRows.filter((row) => row.rawCharacterLeaks.missingVisibleWithAsset.length > 0),
      rawMissingVisibleItemRows: allBindingRows.filter((row) => row.rawItemLeaks.missingVisibleWithAsset.length > 0),
      characterLeakRows: allBindingRows.filter((row) => row.characterLeaks.leakedFiltered.length > 0),
      itemLeakRows: allBindingRows.filter((row) => row.itemLeaks.leakedFiltered.length > 0),
      missingVisibleCharacterRows: allBindingRows.filter((row) => row.characterLeaks.missingVisibleWithAsset.length > 0),
      missingVisibleItemRows: allBindingRows.filter((row) => row.itemLeaks.missingVisibleWithAsset.length > 0),
    },
    characterDetail: {
      runs: characterRuns.length,
      parseRate: rate(characterRuns, (run) => run.parseOk),
      averageStyleCount: avg(characterRuns.map((run) => run.styleCount)),
      metadataRate: rate(characterRuns, (run) => run.metadataCount > 0),
      promptPollutionRuns: characterRuns.filter((run) => run.promptPollutionRows.length > 0),
    },
    usage: summarizeUsage([...sceneRuns, ...bindingRuns, ...characterRuns]),
  };
}

function rate(rows, predicate) {
  return rows.length ? rows.filter(predicate).length / rows.length : 0;
}

function avg(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function summarizeUsage(rows) {
  return rows.reduce((acc, row) => {
    const usage = row.usage ?? {};
    acc.promptTokens += usage.prompt_tokens ?? 0;
    acc.completionTokens += usage.completion_tokens ?? 0;
    acc.totalTokens += usage.total_tokens ?? 0;
    acc.latencyMs += row.latencyMs ?? 0;
    return acc;
  }, { promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });
}

async function main() {
  const results = { scenePlanning: [], referenceBinding: [], characterDetail: [] };
  for (let round = 1; round <= rounds; round += 1) {
    console.log(`[round ${round}/${rounds}] scene planning`);
    const scenePlanning = await evalScenePlanning(round);
    results.scenePlanning.push(scenePlanning);

    console.log(`[round ${round}/${rounds}] reference binding`);
    const binding = await evalReferenceBinding(round, scenePlanning.scenes);
    results.referenceBinding.push(binding);

    for (const asset of selectedCharacters) {
      console.log(`[round ${round}/${rounds}] character detail: ${asset.name}`);
      results.characterDetail.push(await evalCharacterDetail(round, asset));
    }
  }
  const summary = summarize(results);
  const output = {
    generatedAt: new Date().toISOString(),
    fixture: 'evals/fixtures/chi_qingming',
    summary,
    results,
  };
  fs.mkdirSync(outputDir, { recursive: true });
  const outPath = path.join(outputDir, 'chi_qingming_openai_text_eval.json');
  fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${path.relative(repoRoot, outPath)}`);
}

main().catch((err) => {
  console.error('[openai-text-eval failed]', err);
  process.exit(1);
});
