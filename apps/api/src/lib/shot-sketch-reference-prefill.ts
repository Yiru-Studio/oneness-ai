export function mergeShotSketchReferenceIds(
  compositionTask: { characterStyleIds: unknown; sceneIds: unknown; itemIds: unknown },
  shot: { characterStyleIds: unknown; sceneIds: unknown; itemIds: unknown },
) {
  const shotStyleIds = jsonStringArray(shot.characterStyleIds);
  const shotSceneIds = jsonStringArray(shot.sceneIds);
  const shotItemIds = jsonStringArray(shot.itemIds);
  return {
    characterStyleIds: uniqueStrings(shotStyleIds),
    sceneIds: shotSceneIds.length > 0
      ? uniqueStrings(shotSceneIds)
      : uniqueStrings(jsonStringArray(compositionTask.sceneIds)),
    itemIds: uniqueStrings(shotItemIds),
  };
}

export function jsonStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((item): item is string => typeof item === 'string') : [];
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}
