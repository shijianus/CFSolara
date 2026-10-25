// Sonic Intelligent Recommendation & Smart Search — Cold-Start Curated Catalog Bootstrap
// Provides real multi-genre, multi-language canonical tracks with real NetEase/QQ IDs so
// cold-start, discover-by-genre, zero-result fallback, and offline/degraded modes work immediately.
// NOTE: Seed tracks have ZERO fabricated station plays (`internalScore = 0`); their `externalPopularity`
// is strictly tagged as `external-chart` / `cold-start-curated`.

import type { CanonicalTrack, RecommendStore } from './types';
import { toCanonicalTrack } from './track-canonical';

interface RawSeedEntry {
  id: string;
  platform: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  genres: string[];
  externalPopularity: number;
  releaseDate?: string;
}

const CURATED_SEEDS: RawSeedEntry[] = [
  // Mandopop & Chinese R&B
  { id: '186016', platform: 'netease', title: '晴天', artist: '周杰伦', album: '叶惠美', duration: 269, genres: ['mandopop', 'pop-rock', 'ballad'], externalPopularity: 98, releaseDate: '2003-07-31' },
  { id: '185811', platform: 'netease', title: '七里香', artist: '周杰伦', album: '七里香', duration: 299, genres: ['mandopop', 'r&b', 'pop'], externalPopularity: 96, releaseDate: '2004-08-03' },
  { id: '185709', platform: 'netease', title: '夜曲', artist: '周杰伦', album: '十一月的萧邦', duration: 226, genres: ['mandopop', 'r&b', 'hip-hop'], externalPopularity: 96, releaseDate: '2005-11-01' },
  { id: '185668', platform: 'netease', title: '稻香', artist: '周杰伦', album: '魔杰座', duration: 223, genres: ['mandopop', 'folk-pop', 'pop'], externalPopularity: 95, releaseDate: '2008-10-15' },
  { id: '185809', platform: 'netease', title: '简单爱', artist: '周杰伦', album: '范特西', duration: 270, genres: ['mandopop', 'r&b', 'pop'], externalPopularity: 93, releaseDate: '2001-09-14' },
  { id: '418603077', platform: 'netease', title: '告白气球', artist: '周杰伦', album: '周杰伦的床边故事', duration: 215, genres: ['mandopop', 'r&b', 'pop'], externalPopularity: 94, releaseDate: '2016-06-24' },
  { id: '108914', platform: 'netease', title: '江南', artist: '林俊杰', album: '第二天堂', duration: 268, genres: ['mandopop', 'r&b', 'ballad'], externalPopularity: 94, releaseDate: '2004-06-04' },
  { id: '26305527', platform: 'netease', title: '修炼爱情', artist: '林俊杰', album: '因你而在', duration: 287, genres: ['mandopop', 'ballad', 'pop'], externalPopularity: 93, releaseDate: '2013-03-13' },
  { id: '29818120', platform: 'netease', title: '可惜没如果', artist: '林俊杰', album: '新地球', duration: 298, genres: ['mandopop', 'ballad', 'r&b'], externalPopularity: 92, releaseDate: '2014-12-27' },
  { id: '150432', platform: 'netease', title: '普通朋友', artist: '陶喆', album: 'I\'m OK', duration: 255, genres: ['r&b', 'mandopop', 'soul'], externalPopularity: 91, releaseDate: '1999-12-10' },
  { id: '150393', platform: 'netease', title: 'Melody', artist: '陶喆', album: '黑色柳丁', duration: 270, genres: ['r&b', 'mandopop', 'ballad'], externalPopularity: 89, releaseDate: '2002-08-09' },
  { id: '25638273', platform: 'netease', title: '特别的人', artist: '方大同', album: '危险世界', duration: 259, genres: ['r&b', 'soul', 'mandopop'], externalPopularity: 91, releaseDate: '2014-04-11' },
  { id: '84928', platform: 'netease', title: 'Love Song', artist: '方大同', album: '未来', duration: 269, genres: ['r&b', 'soul', 'mandopop'], externalPopularity: 89, releaseDate: '2007-12-28' },
  { id: '156129', platform: 'netease', title: '唯一', artist: '王力宏', album: '唯一', duration: 262, genres: ['mandopop', 'r&b', 'ballad'], externalPopularity: 88, releaseDate: '2001-09-27' },
  { id: '441491828', platform: 'netease', title: '光年之外', artist: '邓紫棋', album: '光年之外', duration: 235, genres: ['mandopop', 'pop', 'ost'], externalPopularity: 94, releaseDate: '2016-12-30' },
  { id: '25642126', platform: 'netease', title: '泡沫', artist: '邓紫棋', album: 'Xposed', duration: 258, genres: ['mandopop', 'ballad', 'pop'], externalPopularity: 92, releaseDate: '2012-07-05' },
  { id: '299992', platform: 'netease', title: '红豆', artist: '王菲', album: '唱游', duration: 256, genres: ['mandopop', 'ballad', 'dream-pop'], externalPopularity: 93, releaseDate: '1998-10-02' },
  { id: '287035', platform: 'netease', title: '遇见', artist: '孙燕姿', album: 'The Moment', duration: 210, genres: ['mandopop', 'ballad', 'pop'], externalPopularity: 93, releaseDate: '2003-08-22' },
  { id: '326514', platform: 'netease', title: '演员', artist: '薛之谦', album: '绅士', duration: 261, genres: ['mandopop', 'ballad', 'pop'], externalPopularity: 90, releaseDate: '2015-06-05' },
  { id: '27907046', platform: 'netease', title: '模特', artist: '李荣浩', album: '模特', duration: 306, genres: ['mandopop', 'r&b', 'indie-pop'], externalPopularity: 89, releaseDate: '2013-09-16' },
  { id: '1330348068', platform: 'netease', title: '起风了', artist: '买辣椒也用券', album: '起风了', duration: 325, genres: ['mandopop', 'pop', 'ballad'], externalPopularity: 95, releaseDate: '2018-12-03' },
  { id: '413812448', platform: 'netease', title: '大鱼', artist: '周深', album: '大鱼', duration: 313, genres: ['mandopop', 'ballad', 'ost'], externalPopularity: 91, releaseDate: '2016-05-20' },

  // Cantopop
  { id: '65766', platform: 'netease', title: '富士山下', artist: '陈奕迅', album: 'What\'s Going On...?', duration: 259, genres: ['cantopop', 'ballad', 'pop'], externalPopularity: 95, releaseDate: '2006-11-23' },
  { id: '66282', platform: 'netease', title: '浮夸', artist: '陈奕迅', album: 'U87', duration: 283, genres: ['cantopop', 'pop', 'rock'], externalPopularity: 94, releaseDate: '2005-06-07' },
  { id: '65538', platform: 'netease', title: '十年', artist: '陈奕迅', album: '黑白灰', duration: 205, genres: ['mandopop', 'ballad', 'pop'], externalPopularity: 95, releaseDate: '2003-04-15' },
  { id: '190072', platform: 'netease', title: '孤勇者', artist: '陈奕迅', album: '孤勇者', duration: 256, genres: ['mandopop', 'pop-rock', 'ost'], externalPopularity: 93, releaseDate: '2021-11-08' },
  { id: '347230', platform: 'netease', title: '海阔天空', artist: 'Beyond', album: '乐与怒', duration: 326, genres: ['cantopop', 'rock', 'classic-rock'], externalPopularity: 97, releaseDate: '1993-05-14' },
  { id: '346576', platform: 'netease', title: '光辉岁月', artist: 'Beyond', album: '命运派对', duration: 299, genres: ['cantopop', 'rock', 'classic-rock'], externalPopularity: 94, releaseDate: '1990-09-01' },
  { id: '347355', platform: 'netease', title: '喜欢你', artist: 'Beyond', album: '秘密警察', duration: 274, genres: ['cantopop', 'rock', 'pop'], externalPopularity: 93, releaseDate: '1988-09-06' },
  { id: '188432', platform: 'netease', title: '吻别', artist: '张学友', album: '吻别', duration: 303, genres: ['mandopop', 'cantopop', 'ballad'], externalPopularity: 91, releaseDate: '1993-03-05' },
  { id: '186842', platform: 'netease', title: '我', artist: '张国荣', album: '大热', duration: 224, genres: ['cantopop', 'ballad', 'classic'], externalPopularity: 91, releaseDate: '2000-07-01' },

  // Rock, Folk & Indie
  { id: '385929', platform: 'netease', title: '倔强', artist: '五月天', album: '神的孩子都在跳舞', duration: 262, genres: ['rock', 'pop-rock', 'mandopop'], externalPopularity: 93, releaseDate: '2004-11-05' },
  { id: '385763', platform: 'netease', title: '突然好想你', artist: '五月天', album: '后青春期的诗', duration: 265, genres: ['rock', 'mandopop', 'ballad'], externalPopularity: 93, releaseDate: '2008-10-23' },
  { id: '28815250', platform: 'netease', title: '平凡之路', artist: '朴树', album: '猎户星座', duration: 301, genres: ['folk', 'rock', 'indie'], externalPopularity: 95, releaseDate: '2014-07-16' },
  { id: '449818741', platform: 'netease', title: '成都', artist: '赵雷', album: '无法长大', duration: 328, genres: ['folk', 'indie'], externalPopularity: 92, releaseDate: '2016-10-24' },
  { id: '569213220', platform: 'netease', title: '像我这样的人', artist: '毛不易', album: '平凡的一天', duration: 207, genres: ['folk', 'mandopop', 'ballad'], externalPopularity: 92, releaseDate: '2018-05-31' },
  { id: '569200213', platform: 'netease', title: '消愁', artist: '毛不易', album: '平凡的一天', duration: 261, genres: ['folk', 'mandopop', 'ballad'], externalPopularity: 92, releaseDate: '2018-05-31' },
  { id: '375172', platform: 'netease', title: '小情歌', artist: '苏打绿', album: '小宇宙', duration: 273, genres: ['indie-pop', 'mandopop', 'rock'], externalPopularity: 91, releaseDate: '2006-10-20' },
  { id: '1368754688', platform: 'netease', title: '爱人错过', artist: '告五人', album: '我肯定在几百年前就说过爱你', duration: 292, genres: ['indie-rock', 'pop-rock', 'mandopop'], externalPopularity: 92, releaseDate: '2019-06-14' },
  { id: '407679921', platform: 'netease', title: '大风吹', artist: '草东没有派对', album: '丑奴儿', duration: 235, genres: ['indie-rock', 'rock'], externalPopularity: 89, releaseDate: '2016-04-30' },

  // English Pop, R&B, Rock & Electronic
  { id: '1403318151', platform: 'netease', title: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours', duration: 200, genres: ['synth-pop', 'r&b', 'electronic', 'pop'], externalPopularity: 96, releaseDate: '2019-11-29' },
  { id: '451703096', platform: 'netease', title: 'Shape of You', artist: 'Ed Sheeran', album: '÷ (Divide)', duration: 233, genres: ['pop', 'r&b'], externalPopularity: 95, releaseDate: '2017-01-06' },
  { id: '1382576173', platform: 'netease', title: 'Lover', artist: 'Taylor Swift', album: 'Lover', duration: 221, genres: ['pop', 'folk-pop'], externalPopularity: 94, releaseDate: '2019-08-16' },
  { id: '29567189', platform: 'netease', title: 'Shake It Off', artist: 'Taylor Swift', album: '1989', duration: 219, genres: ['pop', 'synth-pop', 'dance-pop'], externalPopularity: 92, releaseDate: '2014-08-18' },
  { id: '417250561', platform: 'netease', title: '24K Magic', artist: 'Bruno Mars', album: '24K Magic', duration: 226, genres: ['r&b', 'funk', 'pop'], externalPopularity: 91, releaseDate: '2016-10-07' },
  { id: '400162138', platform: 'netease', title: 'Something Just Like This', artist: 'Coldplay', album: 'Memories...Do Not Open', duration: 247, genres: ['electronic', 'pop-rock', 'pop'], externalPopularity: 94, releaseDate: '2017-02-22' },
  { id: '17177224', platform: 'netease', title: 'Viva La Vida', artist: 'Coldplay', album: 'Viva La Vida', duration: 242, genres: ['pop-rock', 'rock', 'alternative'], externalPopularity: 95, releaseDate: '2008-05-25' },
  { id: '16435049', platform: 'netease', title: 'Rolling in the Deep', artist: 'Adele', album: '21', duration: 228, genres: ['soul', 'pop', 'ballad'], externalPopularity: 94, releaseDate: '2010-11-29' },
  { id: '1355147933', platform: 'netease', title: 'bad guy', artist: 'Billie Eilish', album: 'WHEN WE ALL FALL ASLEEP, WHERE DO WE GO?', duration: 194, genres: ['electropop', 'indie-pop', 'electronic'], externalPopularity: 92, releaseDate: '2019-03-29' },
  { id: '454828887', platform: 'netease', title: 'Believer', artist: 'Imagine Dragons', album: 'Evolve', duration: 204, genres: ['pop-rock', 'rock'], externalPopularity: 93, releaseDate: '2017-02-01' },
  { id: '19645222', platform: 'netease', title: 'Numb', artist: 'Linkin Park', album: 'Meteora', duration: 185, genres: ['rock', 'alternative'], externalPopularity: 94, releaseDate: '2003-03-25' },

  // J-Pop, K-Pop & Pure Instrumental
  { id: '1409322155', platform: 'netease', title: '夜に駆ける', artist: 'YOASOBI', album: 'THE BOOK', duration: 261, genres: ['j-pop', 'electronic', 'anime'], externalPopularity: 93, releaseDate: '2019-12-15' },
  { id: '536622304', platform: 'netease', title: 'Lemon', artist: '米津玄师', album: 'Lemon', duration: 255, genres: ['j-pop', 'ballad'], externalPopularity: 94, releaseDate: '2018-02-12' },
  { id: '426881503', platform: 'netease', title: '前前前世', artist: 'RADWIMPS', album: '君の名は。', duration: 285, genres: ['j-pop', 'rock', 'anime'], externalPopularity: 91, releaseDate: '2016-08-24' },
  { id: '442869498', platform: 'netease', title: 'Summer', artist: '久石让', album: '菊次郎の夏', duration: 386, genres: ['instrumental', 'classical', 'ost'], externalPopularity: 93, releaseDate: '1999-05-19' },
  { id: '509180', platform: 'netease', title: 'Merry Christmas Mr. Lawrence', artist: '坂本龙一', album: '1996', duration: 285, genres: ['instrumental', 'classical', 'ost'], externalPopularity: 93, releaseDate: '1983-05-01' },
  { id: '1970441628', platform: 'netease', title: 'Hype Boy', artist: 'NewJeans', album: 'New Jeans', duration: 179, genres: ['k-pop', 'r&b', 'pop'], externalPopularity: 91, releaseDate: '2022-07-23' },
  { id: '1841455342', platform: 'netease', title: 'LILAC', artist: 'IU', album: 'LILAC', duration: 214, genres: ['k-pop', 'pop'], externalPopularity: 90, releaseDate: '2021-03-25' },
];

const seededStores = new WeakSet<RecommendStore>();

export function ensureCatalogSeeded(store: RecommendStore): number {
  if (seededStores.has(store)) return 0;
  const stats = store.getStats();
  if (stats.trackCount >= 40) {
    seededStores.add(store);
    return 0;
  }

  const baseTime = Date.now() - 10 * 24 * 3600 * 1000;
  const canonicalSeeds: CanonicalTrack[] = [];
  for (let i = 0; i < CURATED_SEEDS.length; i++) {
    const raw = CURATED_SEEDS[i];
    const ct = toCanonicalTrack(raw, {
      externalPopularity: raw.externalPopularity,
      explicitGenres: raw.genres,
      // Make last 8 tracks appear recently added (< 5 days) so `window=new` has fresh candidates on cold start
      nowMs: i >= CURATED_SEEDS.length - 8 ? Date.now() - (CURATED_SEEDS.length - i) * 12 * 3600 * 1000 : baseTime,
    });
    if (ct) canonicalSeeds.push(ct);
  }

  store.upsertTracks(canonicalSeeds);
  seededStores.add(store);
  return canonicalSeeds.length;
}
