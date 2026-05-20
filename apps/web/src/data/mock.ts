import { User, Project, KnowledgeDoc, Character, Item, Scene, StoryboardEpisode, AnalyticsData } from '@/types';

export const mockUser: User = {
  id: '6a04202d3befef5ce911208e',
  email: '1280165525@qq.com',
  name: '黄昱舟',
  credits: 10158,
};

export const mockProjects: Project[] = [
  {
    id: '6a042d2e79ad459e57137732',
    name: '格斗动画',
    ratio: '16:9',
    style: '日漫风格',
    createdAt: '2026-05-13T15:50:06',
    stylePrompt: '精细的素描和简洁的线条，日式漫画风格，武道主题。故事围绕一位格斗选手展开，场景包括道场、城市街头和地下格斗场。角色设计强调力量感和速度感，配色以深蓝、黑色和金色为主。',
    analysisModel: 'Gemini 3 Pro',
    imageModel: 'Nano banana pro',
    videoModel: 'Seedance 2.0',
    generalAnalysis: 'completed',
    basicAnalysis: 'completed',
  },
  {
    id: '6a042d2e79ad459e57137733',
    name: '格斗',
    ratio: '16:9',
    style: '电影质感',
    createdAt: '2026-05-12T10:30:00',
    stylePrompt: '电影级画质，写实风格，强调光影对比和景深效果。动作场面采用快速剪辑和慢镜头结合，色调偏冷，以蓝灰色为主。',
    analysisModel: 'Gemini 3 Pro',
    imageModel: 'Nano banana pro',
    videoModel: 'Seedance 2.0',
    generalAnalysis: 'completed',
    basicAnalysis: 'completed',
  },
];

export const mockCharacters: Character[] = [
  {
    id: 'char1',
    name: '潘杰',
    avatar: '',
    description: 'MAX俱乐部新秀选手，铁亮的师弟。从初出茅庐的散打少年成长为WFC职业综合格斗明星，被称为"格斗奶爸"。',
    bio: 'MAX俱乐部新秀选手，铁亮的师弟。从初出茅庐的散打少年成长为WFC职业综合格斗明星，被称为"格斗奶爸"。',
    voice: '',
    styles: [
      { name: '八角笼竞技造型', image: '' },
      { name: '都市潮男生活造型', image: '' },
      { name: 'WFC职业明星造型', image: '' },
    ],
  },
  {
    id: 'char2',
    name: '铁亮',
    avatar: '',
    description: 'MAX俱乐部老将，中国MMA先驱，首位柔术黑带，绰号"草原鹰"，潘杰的师兄与精神导师。',
    bio: 'MAX俱乐部老将，中国MMA先驱，首位柔术黑带，绰号"草原鹰"，潘杰的师兄与精神导师。',
    styles: [],
  },
  {
    id: 'char3',
    name: '叶子',
    avatar: '',
    description: 'MAX格斗俱乐部总经理，铁亮的未婚妻与事业推手。',
    bio: 'MAX格斗俱乐部总经理，铁亮的未婚妻与事业推手。她不仅是冷峻商业规则的执行者，更是格斗士们情感与生计的最后防线，在精英感与烟火气间完美平衡。',
    styles: [],
  },
  {
    id: 'char4',
    name: '马学军',
    avatar: '',
    description: '铁亮的师父，前摔跤队退休教练。现经营器械维修仓库。',
    bio: '铁亮的师父，前摔跤队退休教练。现经营器械维修仓库，是主角团的精神导师，洞悉人性，传统而重情义。',
    styles: [],
  },
  {
    id: 'char5',
    name: '小盼',
    avatar: '',
    description: '男主角潘杰的妻子，一名平凡而伟大的房产中介。',
    bio: '男主角潘杰的妻子，一名平凡而伟大的房产中介，家庭的现实支柱与情感归宿。',
    styles: [],
  },
  {
    id: 'char6',
    name: '乐乐',
    avatar: '',
    description: '潘杰与小盼的女儿。',
    bio: '潘杰与小盼的女儿。',
    styles: [],
  },
  {
    id: 'char7',
    name: '梁宽',
    avatar: '',
    description: 'WFC赛事首席配对选材官。',
    bio: 'WFC赛事首席配对选材官。',
    styles: [],
  },
  {
    id: 'char8',
    name: '托尼',
    avatar: '',
    description: '野火俱乐部选手，泰拳王，曾导致铁亮腿部骨折。',
    bio: '野火俱乐部选手，泰拳王，曾导致铁亮腿部骨折。',
    styles: [],
  },
  {
    id: 'char9',
    name: '钢塔雷斯',
    avatar: '',
    description: '巴西柔术教练，铁亮曾经的对手，后辅导潘杰。',
    bio: '巴西柔术教练，铁亮曾经的对手，后辅导潘杰。',
    styles: [],
  },
];

export const mockItems: Item[] = [
  { id: 'item1', name: '马鬃绳', image: '' },
  { id: 'item2', name: '橡皮人', image: '' },
  { id: 'item3', name: '旧拳套', image: '' },
  { id: 'item4', name: '三巨头合照', image: '' },
  { id: 'item5', name: '五色项圈', image: '' },
  { id: 'item6', name: '戒指盒', image: '' },
];

export const mockScenes: Scene[] = [
  { id: 'scene1', name: '精武杯联赛现场-擂台-夜', image: '' },
  { id: 'scene2', name: '精武杯联赛现场-VIP看台-夜', image: '' },
  { id: 'scene3', name: '精武杯联赛候场区-夜', image: '' },
  { id: 'scene4', name: '精武杯联赛现场-观众席-夜', image: '' },
  { id: 'scene5', name: '精武杯联赛入场口-夜', image: '' },
  { id: 'scene6', name: '休息区-夜', image: '' },
  { id: 'scene7', name: '医院手术室前-夜', image: '' },
  { id: 'scene8', name: 'MAX俱乐部浴室-夜', image: '' },
  { id: 'scene9', name: 'MAX俱乐部宿舍-夜', image: '' },
  { id: 'scene10', name: '早期MAX俱乐部-室外-日', image: '' },
  { id: 'scene11', name: '早期MAX俱乐部-室内-日', image: '' },
  { id: 'scene12', name: '医院附属康复中心病房-日', image: '' },
  { id: 'scene13', name: '医院附属康复中心走廊-日', image: '' },
  { id: 'scene14', name: '机场停车位-日', image: '' },
  { id: 'scene15', name: '潘杰车内-日', image: '' },
  { id: 'scene16', name: '城郊路旁-日', image: '' },
];

export const mockStoryboardEpisodes: StoryboardEpisode[] = [
  {
    id: 'ep1',
    number: 1,
    title: '第1集',
    content: '《终极格斗》（暂拟）电影剧本 编剧 杜庆春 黄昱舟 刘林青 2021年1月30日 精武杯联赛比赛现场（四角擂台）夜 内 一阵清脆利落的撞击响起，一股鲜血溅射在擂台上。鲜血顺着一位白人选手的颧骨流下...',
    analyzed: true,
    summary: '',
    scenes: [],
  },
];

export const mockAnalytics: AnalyticsData = {
  totalCredits: 327.00,
  imageCount: 19,
  videoCount: 1,
  textTaskCount: 18,
  updateTime: '2026-05-13 18:46:47',
};

export const mockKnowledgeDocs: KnowledgeDoc[] = [];
