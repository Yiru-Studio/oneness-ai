import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function clearAll() {
  await prisma.taskAsset.deleteMany();
  await prisma.task.deleteMany();
  await prisma.characterStyle.deleteMany();
  await prisma.character.deleteMany();
  await prisma.item.deleteMany();
  await prisma.scene.deleteMany();
  await prisma.storyboardEpisode.deleteMany();
  await prisma.knowledgeDoc.deleteMany();
  await prisma.project.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.user.deleteMany();
}

async function main() {
  console.log('Clearing existing data...');
  await clearAll();

  console.log('Creating seed user...');
  const user = await prisma.user.create({
    data: {
      email: '1280165525@qq.com',
      name: '黄昱舟',
      credits: 10158,
    },
  });

  console.log('Creating projects...');
  const project1 = await prisma.project.create({
    data: {
      ownerId: user.id,
      name: '格斗动画',
      ratio: '16:9',
      style: '日漫风格',
      stylePrompt:
        '精细的素描和简洁的线条，日式漫画风格，武道主题。故事围绕一位格斗选手展开，场景包括道场、城市街头和地下格斗场。角色设计强调力量感和速度感，配色以深蓝、黑色和金色为主。',
      analysisModel: 'Gemini 3 Pro',
      imageModel: 'Nano banana pro',
      videoModel: 'Seedance 2.0',
      generalAnalysis: 'COMPLETED',
      basicAnalysis: 'COMPLETED',
    },
  });

  await prisma.project.create({
    data: {
      ownerId: user.id,
      name: '格斗',
      ratio: '16:9',
      style: '电影质感',
      stylePrompt:
        '电影级画质，写实风格，强调光影对比和景深效果。动作场面采用快速剪辑和慢镜头结合，色调偏冷，以蓝灰色为主。',
      analysisModel: 'Gemini 3 Pro',
      imageModel: 'Nano banana pro',
      videoModel: 'Seedance 2.0',
      generalAnalysis: 'COMPLETED',
      basicAnalysis: 'COMPLETED',
    },
  });

  console.log('Creating characters for project1...');
  const characters = [
    {
      name: '潘杰',
      description: 'MAX俱乐部新秀选手，铁亮的师弟。从初出茅庐的散打少年成长为WFC职业综合格斗明星，被称为"格斗奶爸"。',
      bio: 'MAX俱乐部新秀选手，铁亮的师弟。从初出茅庐的散打少年成长为WFC职业综合格斗明星，被称为"格斗奶爸"。',
      styles: ['八角笼竞技造型', '都市潮男生活造型', 'WFC职业明星造型'],
    },
    {
      name: '铁亮',
      description: 'MAX俱乐部老将，中国MMA先驱，首位柔术黑带，绰号"草原鹰"，潘杰的师兄与精神导师。',
      bio: 'MAX俱乐部老将，中国MMA先驱，首位柔术黑带，绰号"草原鹰"，潘杰的师兄与精神导师。',
      styles: [],
    },
    {
      name: '叶子',
      description: 'MAX格斗俱乐部总经理，铁亮的未婚妻与事业推手。',
      bio: 'MAX格斗俱乐部总经理，铁亮的未婚妻与事业推手。她不仅是冷峻商业规则的执行者，更是格斗士们情感与生计的最后防线，在精英感与烟火气间完美平衡。',
      styles: [],
    },
    {
      name: '马学军',
      description: '铁亮的师父，前摔跤队退休教练。现经营器械维修仓库。',
      bio: '铁亮的师父，前摔跤队退休教练。现经营器械维修仓库，是主角团的精神导师，洞悉人性，传统而重情义。',
      styles: [],
    },
    {
      name: '小盼',
      description: '男主角潘杰的妻子，一名平凡而伟大的房产中介。',
      bio: '男主角潘杰的妻子，一名平凡而伟大的房产中介，家庭的现实支柱与情感归宿。',
      styles: [],
    },
    {
      name: '乐乐',
      description: '潘杰与小盼的女儿。',
      bio: '潘杰与小盼的女儿。',
      styles: [],
    },
    {
      name: '梁宽',
      description: 'WFC赛事首席配对选材官。',
      bio: 'WFC赛事首席配对选材官。',
      styles: [],
    },
    {
      name: '托尼',
      description: '野火俱乐部选手，泰拳王，曾导致铁亮腿部骨折。',
      bio: '野火俱乐部选手，泰拳王，曾导致铁亮腿部骨折。',
      styles: [],
    },
    {
      name: '钢塔雷斯',
      description: '巴西柔术教练，铁亮曾经的对手，后辅导潘杰。',
      bio: '巴西柔术教练，铁亮曾经的对手，后辅导潘杰。',
      styles: [],
    },
  ];
  for (const c of characters) {
    await prisma.character.create({
      data: {
        projectId: project1.id,
        name: c.name,
        description: c.description,
        bio: c.bio,
        styles: { create: c.styles.map((name) => ({ name })) },
      },
    });
  }

  console.log('Creating items...');
  const items = [
    '马鬃绳', '橡皮人', '旧拳套', '三巨头合照', '五色项圈', '戒指盒',
  ];
  for (const name of items) {
    await prisma.item.create({ data: { projectId: project1.id, name } });
  }

  console.log('Creating scenes...');
  const scenes = [
    '精武杯联赛现场-擂台-夜',
    '精武杯联赛现场-VIP看台-夜',
    '精武杯联赛候场区-夜',
    '精武杯联赛现场-观众席-夜',
    '精武杯联赛入场口-夜',
    '休息区-夜',
    '医院手术室前-夜',
    'MAX俱乐部浴室-夜',
    'MAX俱乐部宿舍-夜',
    '早期MAX俱乐部-室外-日',
    '早期MAX俱乐部-室内-日',
    '医院附属康复中心病房-日',
    '医院附属康复中心走廊-日',
    '机场停车位-日',
    '潘杰车内-日',
    '城郊路旁-日',
  ];
  for (const name of scenes) {
    await prisma.scene.create({ data: { projectId: project1.id, name } });
  }

  console.log('Creating storyboard episode...');
  await prisma.storyboardEpisode.create({
    data: {
      projectId: project1.id,
      number: 1,
      title: '第1集',
      content:
        '《终极格斗》（暂拟）电影剧本 编剧 杜庆春 黄昱舟 刘林青 2021年1月30日 精武杯联赛比赛现场（四角擂台）夜 内 一阵清脆利落的撞击响起，一股鲜血溅射在擂台上。鲜血顺着一位白人选手的颧骨流下...',
      analyzed: true,
    },
  });

  console.log('Seed complete.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
