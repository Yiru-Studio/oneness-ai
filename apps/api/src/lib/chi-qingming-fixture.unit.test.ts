import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildSceneImageCompositionPrompt,
  cleanSceneImageSummary,
  prefillCompositionReferences,
  type ReferenceLibraryForPlanning,
} from './composition-ai-planning.js';
import { mergeShotSketchReferenceIds } from './shot-sketch-reference-prefill.js';

type FixtureAsset = {
  id: string;
  group: '角色' | '场景' | '道具';
  name: string;
  description: string;
  generation_reference_prompt?: string;
  calibrated_generation_reference_prompt?: string;
};

type FixtureScene = {
  scene_number: string;
  heading: string;
  location: string;
  characters: string[];
  props: string[];
  raw_paragraphs: Array<{ text: string }>;
};

type FullReportItem = {
  scene_number: string;
  scene: string;
  characters: string[];
  filtered_characters: string[];
  props: string[];
  filtered_props: string[];
};

const fixtureRoot = path.resolve(process.cwd(), '../../evals/fixtures/chi_qingming');
const dataset = JSON.parse(
  fs.readFileSync(path.join(fixtureRoot, 'data/chi_qingming.calibrated.dataset.json'), 'utf8'),
) as { assets: FixtureAsset[]; script_scenes: FixtureScene[]; edit_shots: unknown[] };
const fullReport = JSON.parse(
  fs.readFileSync(path.join(fixtureRoot, 'reports/chi_qingming.edit_shots_full_report.json'), 'utf8'),
) as { items: FullReportItem[] };

const library = makeLibrary();
const styleToCharacter = new Map(
  library.characters.flatMap((character) => character.styles.map((style) => [style.id, character.name])),
);
const sceneIdByName = new Map(library.scenes.map((scene) => [scene.name, scene.id]));
const itemIdByName = new Map(library.items.map((item) => [item.name, item.id]));

describe('chi qingming fixture text-chain eval', () => {
  it('loads the lightweight golden fixture with expected counts', () => {
    expect(dataset.assets).toHaveLength(31);
    expect(dataset.script_scenes).toHaveLength(10);
    expect(dataset.edit_shots).toHaveLength(163);
    expect(fullReport.items).toHaveLength(163);
    expect(library.characters).toHaveLength(9);
    expect(library.scenes).toHaveLength(10);
    expect(library.items).toHaveLength(12);
  });

  it('keeps voice-only and mentioned-only characters out of shot sketch refs', () => {
    const phoneBoothShot = fullReport.items.find((item) => item.scene_number === '3' && item.filtered_characters.includes('中年女声'))!;
    const shotRefs = {
      characterStyleIds: namesToStyleIds(phoneBoothShot.characters),
      sceneIds: namesToSceneIds([phoneBoothShot.scene]),
      itemIds: namesToItemIds(phoneBoothShot.props),
    };
    const broadSceneRefs = {
      characterStyleIds: namesToStyleIds(['吴翊杰', '池清明', '中年女声']),
      sceneIds: namesToSceneIds(['电话亭']),
      itemIds: namesToItemIds(['手机', '通讯本']),
    };

    const merged = mergeShotSketchReferenceIds(broadSceneRefs, shotRefs);

    expect(selectedCharacterNames(merged.characterStyleIds)).toEqual(phoneBoothShot.characters);
    expect(selectedCharacterNames(merged.characterStyleIds)).not.toContain('池清明');
    expect(selectedCharacterNames(merged.characterStyleIds)).not.toContain('中年女声');
    expect(itemNames(merged.itemIds)).toEqual(phoneBoothShot.props);
  });

  it('keeps basketball out of non-visual shots but keeps transparent membrane in rooftop planning prompt', () => {
    const nonBasketballShot = fullReport.items.find((item) => item.scene_number === '4' && item.filtered_props.includes('篮球'))!;
    const merged = mergeShotSketchReferenceIds(
      { characterStyleIds: [], sceneIds: namesToSceneIds(['学校篮球场']), itemIds: namesToItemIds(['篮球']) },
      { characterStyleIds: [], sceneIds: namesToSceneIds([nonBasketballShot.scene]), itemIds: [] },
    );
    expect(merged.itemIds).toEqual([]);

    const rooftop = dataset.script_scenes.find((scene) => scene.scene_number === '8')!;
    const refs = prefillCompositionReferences({
      index: 8,
      title: rooftop.heading,
      content: sceneText(rooftop),
      characters: rooftop.characters,
      environment: rooftop.location,
      requiredReferences: { characters: rooftop.characters, scenes: [rooftop.location], items: rooftop.props },
    }, library);
    const prompt = buildSceneImageCompositionPrompt(
      { ratio: '16:9', stylePrompt: '写实电影感' },
      {
        index: 8,
        title: rooftop.heading,
        content: cleanSceneImageSummary(sceneText(rooftop)),
        characters: rooftop.characters,
        environment: rooftop.location,
      },
      {
        ...refs,
        characterStyleLabels: selectedCharacterNames(refs.characterStyleIds).map((name) => `${name} · 默认造型`),
        sceneLabels: sceneNames(refs.sceneIds),
        itemLabels: itemNames(refs.itemIds),
      },
    );

    expect(prompt).toContain('教学楼天台');
    expect(prompt).toContain('透明薄膜');
  });
});

function makeLibrary(): ReferenceLibraryForPlanning {
  return {
    characters: dataset.assets.filter((asset) => asset.group === '角色').map((asset) => ({
      id: asset.id,
      name: asset.name,
      description: asset.description,
      bio: asset.description,
      styles: [{
        id: `${asset.id}__style`,
        name: '默认造型',
        prompt: asset.calibrated_generation_reference_prompt || asset.generation_reference_prompt || asset.description,
        assetId: null,
      }],
    })),
    scenes: dataset.assets.filter((asset) => asset.group === '场景').map((asset) => ({
      id: asset.id,
      name: asset.name,
      description: asset.description,
      prompt: asset.calibrated_generation_reference_prompt || asset.generation_reference_prompt || '',
      assetId: null,
    })),
    items: dataset.assets.filter((asset) => asset.group === '道具').map((asset) => ({
      id: asset.id,
      name: asset.name,
      description: asset.description,
      prompt: asset.calibrated_generation_reference_prompt || asset.generation_reference_prompt || '',
      assetId: null,
    })),
  };
}

function sceneText(scene: FixtureScene): string {
  return scene.raw_paragraphs.map((paragraph) => paragraph.text).join('\n');
}

function namesToStyleIds(names: string[]): string[] {
  return names
    .map((name) => library.characters.find((character) => character.name === name)?.styles[0]?.id)
    .filter((id): id is string => Boolean(id));
}

function namesToSceneIds(names: string[]): string[] {
  return names.map((name) => sceneIdByName.get(name)).filter((id): id is string => Boolean(id));
}

function namesToItemIds(names: string[]): string[] {
  return names.map((name) => itemIdByName.get(name)).filter((id): id is string => Boolean(id));
}

function selectedCharacterNames(styleIds: string[]): string[] {
  return styleIds.map((id) => styleToCharacter.get(id)).filter((name): name is string => Boolean(name));
}

function sceneNames(ids: string[]): string[] {
  return ids.map((id) => library.scenes.find((scene) => scene.id === id)?.name).filter((name): name is string => Boolean(name));
}

function itemNames(ids: string[]): string[] {
  return ids.map((id) => library.items.find((item) => item.id === id)?.name).filter((name): name is string => Boolean(name));
}
