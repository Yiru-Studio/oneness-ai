# 《池清明到底是谁》数据清洗报告

- 生成时间：2026-05-29T14:45:47
- 源数据：`/Users/wanghaoyu/Desktop/当前工作区/AIGC影视/structured_cases/chi_qingming/chi_qingming.dataset.json`
- 清洗数据：`/Users/wanghaoyu/Desktop/当前工作区/AIGC影视/structured_cases/chi_qingming/chi_qingming.cleaned.dataset.json`
- 镜头总数：163
- 资产总数：31
- 场景总数：10

## 清洗规则

- 保留原始数据集不覆盖，所有修改写入 cleaned dataset。
- 根据剧本场景、镜头时间线、关键帧文件存在性和片段时长清洗镜头字段。
- 长于 12 秒的片段保留 `needs_manual_review`，并记录补充关键帧数量。
- 0.75 秒以下片段标记为短闪切候选，不强行删除。
- 未做语音识别和像素级画面理解；不确定信息不伪造成确定标签。

## 修改统计

- 字段修改：`{"visual_summary": 163, "camera": 163, "script_evidence": 161, "confidence": 157, "quality_notes": 16, "alignment_status": 153}`
- 对齐状态：`{"needs_manual_review": 10, "auto_aligned_cleaned": 147, "auto_aligned_short_shot": 6}`
- 置信度：`{"medium": 16, "high": 147}`

## 仍需人工复核的镜头

1, 90, 96, 103, 104, 125, 131, 148, 149, 163

## 每场镜头数量

- 第 1 场 `校办公室`：28 条镜头
- 第 2 场 `网吧`：7 条镜头
- 第 3 场 `电话亭`：9 条镜头
- 第 4 场 `学校篮球场`：36 条镜头
- 第 5 场 `学校走廊/教室`：16 条镜头
- 第 6 场 `校图书馆`：14 条镜头
- 第 7 场 `校园广场`：15 条镜头
- 第 7A 场 `校园主楼·门口大厅`：12 条镜头
- 第 7B 场 `校园主楼·楼梯间`：10 条镜头
- 第 8 场 `教学楼天台`：16 条镜头

## 校验结果

通过

## 下一步 Goal 用法

1. 先运行 benchmark 评分器，确认 cleaned dataset 自身通过硬校验。
2. 用当前 FilmForge 流程跑《池清明》剧本，生成 baseline 输出。
3. 将 baseline 输出与 cleaned dataset 对比，按评分低项优化语义链路和图像链路。
4. 每轮保存报告；总分达到 90 且硬校验通过后停止。
