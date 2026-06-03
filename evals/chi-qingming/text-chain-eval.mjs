import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildSceneImageCompositionPrompt,
  cleanSceneImageSummary,
  prefillCompositionReferences,
  sanitizeReferenceBinding,
  referenceLibraryIdSets,
} from '../../packages/shared/src/composition-planning.ts';
import { mergeShotSketchReferenceIds } from '../../apps/api/src/lib/shot-sketch-reference-prefill.ts';
import { resolveShotReferencesFromNames } from '../../apps/worker/src/lib/shot-reference-prefill.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const fixtureRoot = path.join(repoRoot, 'evals/fixtures/chi_qingming');
const outputDir = path.join(repoRoot, 'evals/outputs');
const datasetPath = path.join(fixtureRoot, 'data/chi_qingming.calibrated.dataset.json');
const fullReportPath = path.join(fixtureRoot, 'reports/chi_qingming.edit_shots_full_report.json');
const manifestPath = path.join(fixtureRoot, 'manifest.json');

const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
const fullReport = JSON.parse(fs.readFileSync(fullReportPath, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

function slug(value) {
  return String(value).replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]+/g, '_');
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function assetKind(group) {
  if (group === '角色') return 'character';
  if (group === '场景') return 'scene';
  return 'item';
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
const styleToCharacter = new Map(library.characters.flatMap((character) => character.styles.map((style) => [style.id, character.name])));
const assetByName = new Map(dataset.assets.map((asset) => [asset.name, asset]));
const characterAssetByName = new Map(dataset.assets.filter((asset) => asset.group === '角色').map((asset) => [asset.name, asset]));
const sceneAssetByName = new Map(dataset.assets.filter((asset) => asset.group === '场景').map((asset) => [asset.name, asset]));
const itemAssetByName = new Map(dataset.assets.filter((asset) => asset.group === '道具').map((asset) => [asset.name, asset]));
const fullReportByShotId = new Map(fullReport.items.map((item) => [item.shot_id, item]));

function episodeSceneFromScriptScene(scene, characters = scene.characters, props = scene.props) {
  const visibleCharacters = unique(fullReport.items.filter((item) => item.scene_number === scene.scene_number).flatMap((item) => item.characters));
  const mentionedCharacters = unique((scene.characters || []).filter((name) => !visibleCharacters.includes(name)));
  const visibleProps = unique(fullReport.items.filter((item) => item.scene_number === scene.scene_number).flatMap((item) => item.props));
  const mentionedProps = unique((scene.props || []).filter((name) => !visibleProps.includes(name)));
  return {
    index: Number.parseInt(String(scene.scene_number).replace(/\D/g, ''), 10) - 1 || 0,
    title: scene.heading,
    content: sceneText(scene),
    characters: characters || [],
    environment: scene.location,
    requiredReferences: {
      characters: characters || [],
      scenes: [scene.location, scene.heading],
      items: props || [],
    },
    sceneReferences: {
      visibleCharacters,
      mentionedCharacters,
      voiceCharacters: mentionedCharacters.filter((name) => /声|旁白|广播/u.test(name)),
      backgroundCharacters: [],
      visibleItems: visibleProps,
      mentionedItems: mentionedProps,
      backgroundItems: [],
    },
  };
}

function refsToNames(refs) {
  return {
    characters: refs.characterStyleIds.map((id) => styleToCharacter.get(id)).filter(Boolean),
    scenes: refs.sceneIds.map((id) => library.scenes.find((scene) => scene.id === id)?.name).filter(Boolean),
    items: refs.itemIds.map((id) => library.items.find((item) => item.id === id)?.name).filter(Boolean),
  };
}

function namesToStyleIds(names) {
  return unique(names.map((name) => library.characters.find((character) => character.name === name)?.styles[0]?.id));
}

function namesToSceneIds(names) {
  return unique(names.map((name) => sceneAssetByName.get(name)?.id));
}

function namesToItemIds(names) {
  return unique(names.map((name) => itemAssetByName.get(name)?.id));
}

function missing(expected, actual) {
  const actualSet = new Set(actual);
  return expected.filter((value) => !actualSet.has(value));
}

function extra(actual, expected) {
  const expectedSet = new Set(expected);
  return actual.filter((value) => !expectedSet.has(value));
}

function buildShotPrompt(shotItem) {
  const characters = shotItem.characters?.length ? `${shotItem.characters.join('、')}在` : '';
  const props = shotItem.props?.length ? `，涉及${shotItem.props.join('、')}` : '';
  return `${characters}${shotItem.scene}${props}，${shotItem.prompt || ''}`;
}

function scenePlanEval() {
  return dataset.script_scenes.map((scene) => {
    const episodeScene = episodeSceneFromScriptScene(scene);
    const refs = prefillCompositionReferences(episodeScene, library);
    const refNames = refsToNames(refs);
    const prompt = buildSceneImageCompositionPrompt(
      { ratio: '16:9', stylePrompt: dataset.filmforge_mapping?.project?.settings?.visualStyle || '写实电影感' },
      { ...episodeScene, content: cleanSceneImageSummary(episodeScene.content) },
      {
        ...refs,
        characterStyleLabels: refNames.characters.map((name) => `${name} · 默认造型`),
        sceneLabels: refNames.scenes,
        itemLabels: refNames.items,
      },
    );
    const rawCharacters = scene.characters || [];
    const visibleCharacters = unique(fullReport.items.filter((item) => item.scene_number === scene.scene_number).flatMap((item) => item.characters));
    const rawProps = scene.props || [];
    const visibleProps = unique(fullReport.items.filter((item) => item.scene_number === scene.scene_number).flatMap((item) => item.props));
    return {
      sceneNumber: scene.scene_number,
      title: scene.heading,
      rawCharacters,
      classifiedVisibleCharacters: episodeScene.sceneReferences.visibleCharacters,
      classifiedMentionedCharacters: episodeScene.sceneReferences.mentionedCharacters,
      classifiedVoiceCharacters: episodeScene.sceneReferences.voiceCharacters,
      visibleCharacters,
      selectedCharacters: refNames.characters,
      overSelectedCharacters: extra(refNames.characters, visibleCharacters),
      rawOverSelectedCharacters: extra(rawCharacters, visibleCharacters),
      rawProps,
      classifiedVisibleItems: episodeScene.sceneReferences.visibleItems,
      classifiedMentionedItems: episodeScene.sceneReferences.mentionedItems,
      visibleProps,
      selectedItems: refNames.items,
      overSelectedItems: extra(refNames.items, visibleProps),
      rawOverSelectedItems: extra(rawProps, visibleProps),
      selectedScenes: refNames.scenes,
      prompt,
      promptChecks: {
        hasScene: prompt.includes(scene.location),
        hasStyle: prompt.includes('写实电影感'),
        hasCriticalTransparentMembrane: scene.scene_number !== '8' || prompt.includes('透明薄膜'),
      },
    };
  });
}

function shotEval() {
  const sceneRows = library.scenes;
  const itemRows = library.items;
  const characters = library.characters.map((character) => ({
    name: character.name,
    styles: character.styles.map((style) => ({ id: style.id, assetId: style.assetId })),
  }));
  return fullReport.items.map((shotItem) => {
    const scene = dataset.script_scenes.find((item) => item.scene_number === shotItem.scene_number);
    const refs = resolveShotReferencesFromNames({
      roles: shotItem.characters,
      items: shotItem.props,
      characters,
      itemRows,
      scene: {
        title: scene?.heading || shotItem.scene,
        environment: scene?.location || shotItem.scene,
        content: shotItem.prompt || shotItem.scene || '',
      },
      sceneRows,
    });
    const refNames = refsToNames(refs);
    const expectedSceneIds = namesToSceneIds([shotItem.scene]);
    const expectedItemIds = namesToItemIds(shotItem.props);
    const expectedCharacterNames = shotItem.characters;
    const sketchPrompt = [
      '请生成一张单张电影分镜场景图，用作后续视频生成的参考首帧。',
      `Shot：#${shotItem.shot_number}`,
      `预计时长：${Math.max(1, Math.round(shotItem.duration))} 秒`,
      `Shot 提示词：\n${buildShotPrompt(shotItem)}`,
      `场景标题：${scene?.heading || shotItem.scene}`,
      `环境：${scene?.location || shotItem.scene}`,
      `剧本片段：\n${shotItem.prompt}`,
      '项目风格：\n写实电影感',
    ].join('\n');
    const mergedRefs = mergeShotSketchReferenceIds(
      {
        characterStyleIds: namesToStyleIds(dataset.script_scenes.find((item) => item.scene_number === shotItem.scene_number)?.characters || []),
        sceneIds: namesToSceneIds([shotItem.scene]),
        itemIds: namesToItemIds(dataset.script_scenes.find((item) => item.scene_number === shotItem.scene_number)?.props || []),
      },
      {
        characterStyleIds: refs.characterStyleIds,
        sceneIds: refs.sceneIds,
        itemIds: refs.itemIds,
      },
    );
    const mergedNames = refsToNames(mergedRefs);
    return {
      shotId: shotItem.shot_id,
      shotNumber: shotItem.shot_number,
      sceneNumber: shotItem.scene_number,
      scene: shotItem.scene,
      duration: shotItem.duration,
      roleNames: shotItem.characters,
      selectedCharacters: refNames.characters,
      selectedScenes: refNames.scenes,
      selectedItems: refNames.items,
      expectedCharacters: expectedCharacterNames,
      expectedItems: shotItem.props,
      missingCharacters: missing(expectedCharacterNames, refNames.characters),
      extraCharacters: extra(refNames.characters, expectedCharacterNames),
      missingItems: missing(shotItem.props, refNames.items),
      extraItems: extra(refNames.items, shotItem.props),
      missingScenes: missing(expectedSceneIds, refs.sceneIds),
      mergedSketchReferenceNames: mergedNames,
      sketchPrompt,
      checks: {
        promptHasScene: sketchPrompt.includes(shotItem.scene),
        promptHasVisibleCharacters: expectedCharacterNames.every((name) => sketchPrompt.includes(name)),
        promptHasVisibleItems: shotItem.props.every((name) => sketchPrompt.includes(name)),
        noFilteredCharacters: (shotItem.filtered_characters || []).every((name) => !refNames.characters.includes(name) && !mergedNames.characters.includes(name)),
        noFilteredProps: (shotItem.filtered_props || []).every((name) => !refNames.items.includes(name) && !mergedNames.items.includes(name)),
      },
    };
  });
}

function resourceMetadataAudit() {
  return dataset.assets.map((asset) => ({
    id: asset.id,
    name: asset.name,
    group: asset.group,
    mappedKind: assetKind(asset.group),
    hasEntityName: Boolean(asset.name),
    hasDescription: Boolean(asset.description),
    hasPrompt: Boolean(asset.calibrated_generation_reference_prompt || asset.generation_reference_prompt),
    hasAliases: Array.isArray(asset.aliases) && asset.aliases.length > 0,
    hasSourceEvidence: Array.isArray(asset.evidence) && asset.evidence.length > 0,
    hasStatus: Boolean(asset.status),
    optionalImagePathOnly: Boolean(asset.image_calibration?.image_url),
  }));
}

function timelineAudit() {
  const sorted = [...dataset.edit_shots].sort((a, b) => a.start - b.start);
  const gaps = [];
  const overlaps = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const delta = Number((cur.start - prev.end).toFixed(3));
    if (delta > 0.034) gaps.push({ prev: prev.id, current: cur.id, gap: delta });
    if (delta < -0.034) overlaps.push({ prev: prev.id, current: cur.id, overlap: Math.abs(delta) });
  }
  return { gaps, overlaps };
}

function summarize(sceneResults, shotResults, resourceRows, timeline) {
  const allShotChecks = shotResults.flatMap((shot) => Object.entries(shot.checks).map(([key, ok]) => ({ key, ok, shotNumber: shot.shotNumber })));
  const invalidBinding = sanitizeReferenceBinding({
    sceneIndex: 0,
    characterStyleIds: [library.characters[0]?.styles[0]?.id, 'missing-style'].filter(Boolean),
    sceneIds: [library.scenes[0]?.id, 'missing-scene'].filter(Boolean),
    itemIds: [library.items[0]?.id, 'missing-item'].filter(Boolean),
  }, referenceLibraryIdSets(library));
  return {
    counts: {
      assets: dataset.assets.length,
      scriptScenes: dataset.script_scenes.length,
      editShots: dataset.edit_shots.length,
      characters: library.characters.length,
      scenes: library.scenes.length,
      items: library.items.length,
    },
    fixtureExpected: manifest.summary,
    reportBaselineMetrics: fullReport.metrics,
    sceneMetrics: {
      total: sceneResults.length,
      promptsWithScene: sceneResults.filter((item) => item.promptChecks.hasScene).length,
      promptsWithStyle: sceneResults.filter((item) => item.promptChecks.hasStyle).length,
      criticalTransparentMembraneOk: sceneResults.find((item) => item.sceneNumber === '8')?.promptChecks.hasCriticalTransparentMembrane ?? false,
      rawSceneOverSelectedCharacters: sceneResults.filter((item) => item.overSelectedCharacters.length > 0).map((item) => ({ sceneNumber: item.sceneNumber, overSelectedCharacters: item.overSelectedCharacters })),
      rawSceneOverSelectedItems: sceneResults.filter((item) => item.overSelectedItems.length > 0).map((item) => ({ sceneNumber: item.sceneNumber, overSelectedItems: item.overSelectedItems })),
      rawInputOverSelectedCharacters: sceneResults.filter((item) => item.rawOverSelectedCharacters.length > 0).map((item) => ({ sceneNumber: item.sceneNumber, rawOverSelectedCharacters: item.rawOverSelectedCharacters })),
      rawInputOverSelectedItems: sceneResults.filter((item) => item.rawOverSelectedItems.length > 0).map((item) => ({ sceneNumber: item.sceneNumber, rawOverSelectedItems: item.rawOverSelectedItems })),
      classifiedSceneOverSelectedCharacters: sceneResults.filter((item) => item.overSelectedCharacters.length > 0).length,
      classifiedSceneOverSelectedItems: sceneResults.filter((item) => item.overSelectedItems.length > 0).length,
    },
    shotMetrics: {
      total: shotResults.length,
      characterReferenceAccuracy: shotResults.filter((shot) => shot.missingCharacters.length === 0 && shot.extraCharacters.length === 0).length / shotResults.length,
      itemReferenceAccuracy: shotResults.filter((shot) => shot.missingItems.length === 0 && shot.extraItems.length === 0).length / shotResults.length,
      sceneReferenceAccuracy: shotResults.filter((shot) => shot.missingScenes.length === 0).length / shotResults.length,
      promptCompletenessRate: allShotChecks.filter((item) => item.ok).length / allShotChecks.length,
      filteredCharacterLeakCount: shotResults.filter((shot) => !shot.checks.noFilteredCharacters).length,
      filteredPropLeakCount: shotResults.filter((shot) => !shot.checks.noFilteredProps).length,
      sampleFailures: shotResults.filter((shot) => (
        shot.missingCharacters.length || shot.extraCharacters.length || shot.missingItems.length || shot.extraItems.length || shot.missingScenes.length || !shot.checks.noFilteredCharacters || !shot.checks.noFilteredProps
      )).slice(0, 12),
    },
    resourceMetadata: {
      total: resourceRows.length,
      allHaveIdNameKindDescriptionPromptStatus: resourceRows.every((row) => row.id && row.name && row.mappedKind && row.hasDescription && row.hasPrompt && row.hasStatus),
      missingPromptAssets: resourceRows.filter((row) => !row.hasPrompt).map((row) => row.name),
      missingEvidenceAssets: resourceRows.filter((row) => !row.hasSourceEvidence).map((row) => row.name),
    },
    bindingSanitizationSample: invalidBinding,
    timeline: {
      gapCount: timeline.gaps.length,
      overlapCount: timeline.overlaps.length,
      gaps: timeline.gaps.slice(0, 5),
      overlaps: timeline.overlaps.slice(0, 5),
    },
    providerCalls: {
      image: 0,
      video: 0,
      text: 0,
      note: 'This eval imports pure local functions and fixture JSON only; no providers, queues, DB, image, or video generation are invoked.',
    },
  };
}

const sceneResults = scenePlanEval();
const shotResults = shotEval();
const resources = resourceMetadataAudit();
const timeline = timelineAudit();
const summary = summarize(sceneResults, shotResults, resources, timeline);
const output = {
  generatedAt: new Date().toISOString(),
  fixture: {
    root: 'evals/fixtures/chi_qingming',
    dataset: 'data/chi_qingming.calibrated.dataset.json',
    fullReport: 'reports/chi_qingming.edit_shots_full_report.json',
  },
  summary,
  sceneResults,
  shotResults,
  resourceMetadata: resources,
};
fs.mkdirSync(outputDir, { recursive: true });
const outPath = path.join(outputDir, 'chi_qingming_text_chain_eval.json');
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
console.log(`\nWrote ${path.relative(repoRoot, outPath)}`);
