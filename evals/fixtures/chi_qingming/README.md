# 池清明测试数据包

这是一份从 `structured_cases/chi_qingming` 整理出的轻量 fixture 包，用于迁移到其他项目做解析、镜头拆解、资产识别、prompt 质量、视觉一致性等优化验证。

## 快速使用

优先使用：

- `data/chi_qingming.calibrated.dataset.json`：推荐入口，包含清洗后的 163 个剪辑镜头、31 个资产、10 个剧本场景，以及图片生成校准信息。
- `data/chi_qingming.annotated.dataset.json`：带图片标注信息，适合做视觉评测或人工复核。
- `reports/chi_qingming.edit_shots_full_report.json`：163 镜头全量规则评测结果，可作为回归基线。
- `reports/chi_qingming.benchmark_score.json`：轻量评分结果，可作为快速门槛检查。

建议在目标项目中放到：

```text
test-fixtures/chi_qingming/
```

或：

```text
evals/fixtures/chi_qingming/
```

## 目录说明

```text
data/
  chi_qingming.dataset.json              原始结构化数据
  chi_qingming.cleaned.dataset.json      清洗后数据
  chi_qingming.calibrated.dataset.json   推荐主入口
  chi_qingming.annotated.dataset.json    带图片标注的数据

reports/
  *.json / *.md                          基线、全量镜头、抽样镜头、图片 benchmark、视觉判断等报告

visual_refs/
  *.jpg                                  轻量 contact sheet 视觉参考
  chi_qingming.edit_shots_gallery.html   镜头画廊页面

tools/
  build_chi_qingming_dataset.py          原始构建脚本
  clean_chi_qingming_dataset.py          清洗脚本
  score_chi_qingming_benchmark.py        评分脚本

manifest.json                            文件清单和用途说明
CHECKSUMS.sha256                         文件完整性校验
```

## 数据规模

- 剧本标题：`池清明到底是谁`
- 资产数量：31
- 剧本场景：10
- 剪辑镜头：163
- 导出包大小：约 5.6M

原始目录约 380M，其中 `edit_shot_sample_images/` 约 348M，本包没有复制该大图片目录。若另一个项目需要逐镜头真实图片回归测试，可以从源目录追加：

```text
/Users/wanghaoyu/Desktop/当前工作区/AIGC影视/structured_cases/chi_qingming/edit_shot_sample_images
/Users/wanghaoyu/Desktop/当前工作区/AIGC影视/structured_cases/chi_qingming/keyframes
```

## 建议接入方式

1. 先用 `data/chi_qingming.calibrated.dataset.json` 跑目标项目当前逻辑，保存 baseline。
2. 用 `reports/chi_qingming.edit_shots_full_report.json` 中的指标作为参考门槛。
3. 优化后再次跑同一份 fixture，比较资产召回、场景覆盖、镜头对齐、prompt 完整性、关键视觉约束等指标。
4. 如果目标项目有图片生成或视觉判断链路，再接入 `data/chi_qingming.annotated.dataset.json` 和 `visual_refs/`。

## 迁移校验

复制后可在目标项目中运行：

```bash
shasum -a 256 -c CHECKSUMS.sha256
```

如果目录层级改变，先进入本包根目录再执行校验。
