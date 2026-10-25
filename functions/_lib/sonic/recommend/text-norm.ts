// Sonic Intelligent Recommendation & Smart Search — Text Normalization, CJK, Pinyin, Aliases & Fuzzy Matching
// Zero external dependencies; 100% compatible with Cloudflare Workers (V8 Isolate) and Linux Node.js 22.

import type { InferredLanguage, TrackEdition } from './types';

// ── 1. Traditional ↔ Simplified Chinese Character Mapping (100% Explicit Verified Tuples) ──
const TRAD_SIMP_TUPLES: Array<[string, string]> = [
  ['愛', '爱'], ['戀', '恋'], ['風', '风'], ['雲', '云'], ['歲', '岁'], ['裡', '里'], ['裏', '里'], ['後', '后'], ['發', '发'], ['髮', '发'],
  ['聽', '听'], ['說', '说'], ['讓', '让'], ['過', '过'], ['還', '还'], ['這', '这'], ['個', '个'], ['們', '们'], ['時', '时'], ['間', '间'],
  ['東', '东'], ['陳', '陈'], ['鄧', '邓'], ['張', '张'], ['學', '学'], ['劉', '刘'], ['華', '华'], ['倫', '伦'], ['傑', '杰'], ['孫', '孙'],
  ['蘇', '苏'], ['綠', '绿'], ['盧', '卢'], ['廣', '广'], ['沒', '没'], ['對', '对'], ['闊', '阔'], ['紅', '红'], ['氣', '气'], ['員', '员'],
  ['體', '体'], ['無', '无'], ['條', '条'], ['單', '单'], ['車', '车'], ['誇', '夸'], ['約', '约'], ['溫', '温'], ['強', '强'], ['見', '见'],
  ['煉', '炼'], ['擁', '拥'], ['會', '会'], ['達', '达'], ['爾', '尔'], ['傳', '传'], ['顏', '颜'], ['舊', '旧'], ['萬', '万'], ['願', '愿'],
  ['魚', '鱼'], ['樣', '样'], ['藍', '蓝'], ['蓮', '莲'], ['語', '语'], ['詞', '词'], ['聲', '声'], ['響', '响'], ['樂', '乐'], ['夢', '梦'],
  ['淚', '泪'], ['傷', '伤'], ['記', '记'], ['憶', '忆'], ['懷', '怀'], ['離', '离'], ['別', '别'], ['親', '亲'], ['殘', '残'], ['獨', '独'],
  ['憂', '忧'], ['歡', '欢'], ['遺', '遗'], ['錯', '错'], ['遠', '远'], ['瀟', '潇'], ['灑', '洒'], ['執', '执'], ['堅', '坚'], ['猶', '犹'],
  ['尋', '寻'], ['歸', '归'], ['牽', '牵'], ['掛', '挂'], ['癡', '痴'], ['覺', '觉'], ['釋', '释'], ['從', '从'], ['寧', '宁'], ['靜', '静'],
  ['詳', '详'], ['熾', '炽'], ['熱', '热'], ['閃', '闪'], ['絢', '绚'], ['麗', '丽'], ['蒼', '苍'], ['遙', '遥'], ['遼', '辽'], ['淺', '浅'],
  ['暫', '暂'], ['長', '长'], ['恆', '恒'], ['剎', '刹'], ['來', '来'], ['開', '开'], ['結', '结'], ['終', '终'], ['點', '点'], ['轉', '转'],
  ['輪', '轮'], ['迴', '回'], ['緣', '缘'], ['蹟', '迹'], ['話', '话'], ['專', '专'], ['輯', '辑'], ['選', '选'], ['飆', '飙'], ['經', '经'],
  ['搖', '摇'], ['滾', '滚'], ['謠', '谣'], ['電', '电'], ['調', '调'], ['饒', '饶'], ['國', '国'], ['粵', '粤'], ['閩', '闽'], ['雙', '双'],
  ['節', '节'], ['蘭', '兰'], ['龍', '龙'], ['捲', '卷'], ['楓', '枫'], ['軌', '轨'], ['擱', '搁'], ['號', '号'], ['島', '岛'], ['鐵', '铁'],
  ['簡', '简'], ['綱', '纲'], ['媽', '妈'], ['煙', '烟'], ['塵', '尘'], ['棧', '栈'], ['麼', '么'], ['課', '课'], ['偉', '伟'], ['窩', '窝'],
  ['餘', '余'], ['著', '着'], ['為', '为'], ['輝', '辉'], ['鐘', '钟'], ['曖', '暧'], ['書', '书'], ['孃', '娘'], ['計', '计'], ['藝', '艺'],
  ['術', '术'], ['乾', '干'], ['實', '实'], ['煩', '烦'], ['惱', '恼'], ['聖', '圣'], ['誕', '诞'], ['陰', '阴'], ['領', '领'], ['葉', '叶'],
  ['邊', '边'], ['運', '运'], ['頭', '头'], ['贏', '赢'], ['練', '练'], ['習', '习'], ['餓', '饿'], ['陽', '阳'], ['闕', '阙'], ['難', '难'],
  ['灘', '滩'], ['滄', '沧'], ['兒', '儿'], ['當', '当'], ['繼', '继'], ['續', '续'], ['門', '门'], ['師', '师'], ['澤', '泽'], ['濱', '滨'],
  ['倉', '仓'], ['韓', '韩'], ['權', '权'], ['賢', '贤'], ['齊', '齐'], ['峯', '峰'], ['謝', '谢'], ['楊', '杨'], ['鄭', '郑'], ['許', '许'],
  ['瀧', '泷'], ['彥', '彦'], ['靚', '靓'], ['穎', '颖'], ['筆', '笔'], ['暢', '畅'], ['吳', '吴'], ['韋', '韦'], ['禮', '礼'], ['蕭', '萧'],
  ['騰', '腾'], ['團', '团'], ['劃', '划'], ['飛', '飞'], ['鳥', '鸟'], ['馬', '马'], ['霧', '雾'], ['靈', '灵'], ['頁', '页'], ['頂', '顶'],
  ['順', '顺'], ['須', '须'], ['頓', '顿'], ['顧', '顾'], ['顯', '显'], ['飄', '飘'], ['飯', '饭'], ['飲', '饮'], ['飽', '饱'], ['飾', '饰'],
  ['餅', '饼'], ['館', '馆'], ['駐', '驻'], ['駕', '驾'], ['駛', '驶'], ['騎', '骑'], ['騙', '骗'], ['騷', '骚'], ['驅', '驱'], ['驕', '骄'],
  ['驚', '惊'], ['驗', '验'], ['鬆', '松'], ['鬥', '斗'], ['鬧', '闹'], ['鬱', '郁'], ['魯', '鲁'], ['鮮', '鲜'], ['鯨', '鲸'], ['鳳', '凤'],
  ['鳴', '鸣'], ['鴻', '鸿'], ['鵝', '鹅'], ['鷹', '鹰'], ['麥', '麦'], ['黃', '黄'], ['認', '认'], ['黨', '党'], ['齒', '齿'], ['齡', '龄'],
  ['龐', '庞'], ['龜', '龟'], ['態', '态'], ['憐', '怜'], ['憑', '凭'], ['憲', '宪'], ['應', '应'], ['懶', '懒'], ['戲', '戏'], ['戰', '战'],
  ['戶', '户'], ['撲', '扑'], ['揚', '扬'], ['換', '换'], ['揮', '挥'], ['損', '损'], ['搶', '抢'], ['摺', '折'], ['擊', '击'], ['撥', '拨'],
  ['撫', '抚'], ['擇', '择'], ['擋', '挡'], ['擔', '担'], ['據', '据'], ['擠', '挤'], ['擬', '拟'], ['擲', '掷'], ['擴', '扩'], ['擺', '摆'],
  ['擾', '扰'], ['攏', '拢'], ['攔', '拦'], ['攜', '携'], ['攝', '摄'], ['攤', '摊'], ['數', '数'], ['敵', '敌'], ['斷', '断'], ['於', '于'],
  ['昇', '升'], ['晝', '昼'], ['晉', '晋'], ['曬', '晒'], ['曉', '晓'], ['暈', '晕'], ['暉', '晖'], ['曠', '旷'], ['機', '机'], ['殺', '杀'],
  ['雜', '杂'], ['桿', '杆'], ['槓', '杠'], ['極', '极'], ['構', '构'], ['槍', '枪'], ['櫃', '柜'], ['檸', '柠'], ['檻', '槛'], ['檯', '台'],
  ['櫻', '樱'], ['欄', '栏'], ['欽', '钦'], ['歐', '欧'], ['殞', '殒'], ['殤', '殇'], ['殼', '壳'], ['毀', '毁'], ['湯', '汤'], ['決', '决'],
  ['沖', '冲'], ['溝', '沟'], ['瀝', '沥'], ['淪', '沦'], ['滬', '沪'], ['況', '况'], ['洩', '泄'], ['洶', '汹'], ['漿', '浆'], ['澆', '浇'],
  ['濁', '浊'], ['測', '测'], ['濟', '济'], ['瀏', '浏'], ['渾', '浑'], ['濃', '浓'], ['塗', '涂'], ['濤', '涛'], ['漣', '涟'], ['渦', '涡'],
  ['渙', '涣'], ['滌', '涤'], ['潤', '润'], ['澗', '涧'], ['漲', '涨'], ['澀', '涩'], ['涼', '凉'], ['瓊', '琼'], ['瓏', '珑'], ['產', '产'],
  ['甦', '苏'], ['畫', '画'], ['畝', '亩'], ['畢', '毕'], ['異', '异'], ['疇', '畴'], ['瘋', '疯'], ['療', '疗'], ['癒', '愈'], ['癢', '痒'],
  ['癥', '症'], ['癮', '瘾'], ['皺', '皱'], ['盞', '盏'], ['鹽', '盐'], ['監', '监'], ['蓋', '盖'], ['盜', '盗'], ['盤', '盘'], ['盡', '尽'],
  ['盪', '荡'], ['矚', '瞩'], ['眾', '众'], ['睜', '睁'], ['瞞', '瞒'], ['礎', '础'], ['礙', '碍'], ['禎', '祯'], ['禱', '祷'], ['禍', '祸'],
  ['祿', '禄'], ['禪', '禅'], ['禿', '秃'], ['種', '种'], ['稅', '税'], ['稱', '称'], ['穀', '谷'], ['積', '积'], ['穩', '稳'], ['穫', '获'],
  ['窮', '穷'], ['窺', '窥'], ['竅', '窍'], ['竊', '窃'], ['競', '竞'], ['篤', '笃'], ['筍', '笋'], ['箋', '笺'], ['籠', '笼'], ['籬', '篱'],
  ['類', '类'], ['糧', '粮'], ['糾', '纠'], ['紀', '纪'], ['純', '纯'], ['紗', '纱'], ['紙', '纸'], ['級', '级'], ['紛', '纷'], ['紡', '纺'],
  ['細', '细'], ['紳', '绅'], ['紹', '绍'], ['組', '组'], ['絆', '绊'], ['絕', '绝'], ['絞', '绞'], ['絡', '络'], ['給', '给'], ['絨', '绒'],
  ['統', '统'], ['絲', '丝'], ['綁', '绑'], ['綏', '绥'], ['綑', '捆'], ['綜', '综'], ['綢', '绸'], ['線', '线'], ['維', '维'], ['網', '网'],
  ['繃', '绷'], ['綴', '缀'], ['綵', '彩'], ['綺', '绮'], ['綻', '绽'], ['綽', '绰'], ['綿', '绵'], ['緊', '紧'], ['緒', '绪'], ['緝', '缉'],
  ['緞', '缎'], ['締', '缔'], ['編', '编'], ['緩', '缓'], ['緬', '缅'], ['緯', '纬'], ['緲', '缈'], ['緻', '致'], ['縛', '缚'], ['縣', '县'],
  ['縫', '缝'], ['縮', '缩'], ['縱', '纵'], ['縷', '缕'], ['縹', '缥'], ['總', '总'], ['績', '绩'], ['繆', '缪'], ['繚', '缭'], ['繞', '绕'],
  ['繡', '绣'], ['繩', '绳'], ['繪', '绘'], ['繫', '系'], ['繭', '茧'], ['繳', '缴'], ['繹', '绎'], ['繽', '缤'], ['纏', '缠'], ['纖', '纤'],
  ['纜', '缆'], ['羅', '罗'], ['罰', '罚'], ['罷', '罢'], ['羈', '羁'], ['羨', '羡'], ['義', '义'], ['翹', '翘'], ['聳', '耸'], ['恥', '耻'],
  ['聶', '聂'], ['聾', '聋'], ['職', '职'], ['聯', '联'], ['聰', '聪'], ['肅', '肃'], ['膽', '胆'], ['勝', '胜'], ['朧', '胧'], ['脅', '胁'],
  ['脈', '脉'], ['臟', '脏'], ['腦', '脑'], ['腳', '脚'], ['脫', '脱'], ['脹', '胀'], ['腎', '肾'], ['腫', '肿'], ['膩', '腻'], ['膚', '肤'],
  ['膠', '胶'], ['臉', '脸'], ['臘', '腊'], ['臥', '卧'], ['臨', '临'], ['與', '与'], ['興', '兴'], ['舉', '举'], ['舖', '铺'], ['艙', '舱'],
  ['艦', '舰'], ['艱', '艰'], ['艷', '艳'], ['蘆', '芦'], ['葦', '苇'], ['蘊', '蕴'], ['蘋', '苹'], ['蘚', '藓'], ['蘿', '萝'], ['虜', '虏'],
  ['慮', '虑'], ['處', '处'], ['虛', '虚'], ['虧', '亏'], ['雖', '虽'], ['蝦', '虾'], ['蝕', '蚀'], ['蟻', '蚁'], ['螞', '蚂'], ['螢', '萤'],
  ['蟬', '蝉'], ['蟲', '虫'], ['蠅', '蝇'], ['蠍', '蝎'], ['蠟', '蜡'], ['蠶', '蚕'], ['蠻', '蛮'], ['衛', '卫'], ['衝', '冲'], ['補', '补'],
  ['襯', '衬'], ['襖', '袄'], ['襪', '袜'], ['襲', '袭'], ['裝', '装'], ['製', '制'], ['複', '复'], ['褻', '亵'], ['觀', '观'], ['覓', '觅'],
  ['視', '视'], ['覽', '览'], ['觸', '触'], ['訂', '订'], ['訊', '讯'], ['討', '讨'], ['訓', '训'], ['託', '托'], ['訛', '讹'], ['訝', '讶'],
  ['訟', '讼'], ['訣', '诀'], ['訪', '访'], ['設', '设'], ['訴', '诉'], ['診', '诊'], ['註', '注'], ['証', '证'], ['詐', '诈'], ['詔', '诏'],
  ['評', '评'], ['詛', '诅'], ['詠', '咏'], ['詢', '询'], ['試', '试'], ['詩', '诗'], ['詫', '诧'], ['詭', '诡'], ['詰', '诘'], ['該', '该'],
  ['詼', '诙'], ['誅', '诛'], ['譽', '誉'], ['誌', '志'], ['誘', '诱'], ['誠', '诚'], ['誡', '诫'], ['誣', '诬'], ['誤', '误'], ['誦', '诵'],
  ['誨', '诲'], ['誰', '谁'], ['誹', '诽'], ['誼', '谊'], ['諄', '谆'], ['談', '谈'], ['請', '请'], ['諒', '谅'], ['論', '论'], ['諜', '谍'],
  ['諦', '谛'], ['諧', '谐'], ['諫', '谏'], ['諭', '谕'], ['諮', '咨'], ['諱', '讳'], ['諷', '讽'], ['諸', '诸'], ['諺', '谚'], ['諾', '诺'],
  ['謀', '谋'], ['謂', '谓'], ['謊', '谎'], ['謎', '谜'], ['謗', '谤'], ['謙', '谦'], ['講', '讲'], ['謹', '谨'], ['證', '证'], ['譏', '讥'],
  ['識', '识'], ['譚', '谭'], ['譜', '谱'], ['譯', '译'], ['議', '议'], ['譴', '谴'], ['護', '护'], ['讀', '读'], ['變', '变'], ['讚', '赞'],
  ['豈', '岂'], ['豎', '竖'], ['豐', '丰'], ['豬', '猪'], ['貓', '猫'], ['獻', '献'], ['獄', '狱'], ['獅', '狮'], ['獎', '奖'], ['獲', '获'],
  ['獵', '猎'], ['獸', '兽'], ['貝', '贝'], ['貞', '贞'], ['負', '负'], ['財', '财'], ['貢', '贡'], ['貧', '贫'], ['貨', '货'], ['販', '贩'],
  ['貪', '贪'], ['貫', '贯'], ['責', '责'], ['貯', '贮'], ['貳', '贰'], ['貴', '贵'], ['貶', '贬'], ['買', '买'], ['貸', '贷'], ['費', '费'],
  ['貼', '贴'], ['貿', '贸'], ['賀', '贺'], ['賂', '赂'], ['賃', '赁'], ['賄', '贿'], ['資', '资'], ['賈', '贾'], ['賊', '贼'], ['賓', '宾'],
  ['賜', '赐'], ['賞', '赏'], ['賠', '赔'], ['賣', '卖'], ['賤', '贱'], ['賦', '赋'], ['質', '质'], ['賬', '账'], ['賭', '赌'], ['賴', '赖'],
  ['賺', '赚'], ['購', '购'], ['賽', '赛'], ['贅', '赘'], ['贈', '赠'], ['贊', '赞'], ['贍', '赡'], ['贓', '赃'], ['贖', '赎'], ['贛', '赣'],
  ['趙', '赵'], ['趕', '赶'], ['趨', '趋'], ['跡', '迹'], ['踐', '践'], ['踴', '踊'], ['躊', '踌'], ['蹤', '踪'], ['躍', '跃'], ['軀', '躯'],
  ['軋', '轧'], ['軍', '军'], ['軒', '轩'], ['軟', '软'], ['軸', '轴'], ['較', '较'], ['載', '载'], ['輔', '辅'], ['輕', '轻'], ['輛', '辆'],
  ['輩', '辈'], ['輸', '输'], ['輻', '辐'], ['輾', '辗'], ['轄', '辖'], ['轎', '轿'], ['轟', '轰'], ['辭', '辞'], ['辦', '办'], ['辮', '辫'],
  ['辯', '辩'], ['農', '农'], ['適', '适'], ['遞', '递'], ['逕', '径'], ['連', '连'], ['週', '周'], ['進', '进'], ['遊', '游'], ['違', '违'],
  ['遜', '逊'], ['遲', '迟'], ['遷', '迁'], ['邁', '迈'], ['邇', '迩'], ['邏', '逻'], ['鄒', '邹'], ['鄰', '邻'], ['郵', '邮'], ['醬', '酱'],
  ['醜', '丑'], ['醞', '酝'], ['釀', '酿'], ['針', '针'], ['釘', '钉'], ['釣', '钓'], ['釦', '扣'], ['釵', '钗'], ['鈍', '钝'], ['鈔', '钞'],
  ['鈉', '钠'], ['鋼', '钢'], ['鑰', '钥'], ['鈞', '钧'], ['鉤', '钩'], ['鈕', '钮'], ['錢', '钱'], ['鉗', '钳'], ['鉢', '钵'], ['鈴', '铃'],
  ['鉑', '铂'], ['鉛', '铅'], ['鉚', '铆'], ['鑠', '铄'], ['鐸', '铎'], ['銅', '铜'], ['鋁', '铝'], ['鉻', '铬'], ['銀', '银'], ['銘', '铭'],
  ['銜', '衔'], ['銳', '锐'], ['銷', '销'], ['銹', '锈'], ['鋒', '锋'], ['鋤', '锄'], ['鋪', '铺'], ['鋸', '锯'], ['錄', '录'], ['錐', '锥'],
  ['錘', '锤'], ['錚', '铮'], ['錠', '锭'], ['錦', '锦'], ['錨', '锚'], ['錫', '锡'], ['錮', '锢'], ['錳', '锰'], ['錶', '表'], ['鍋', '锅'],
  ['鍍', '镀'], ['鍛', '锻'], ['鍵', '键'], ['鍾', '钟'], ['鎂', '镁'], ['鎊', '镑'], ['鎖', '锁'], ['鎮', '镇'], ['鎳', '镍'], ['鐫', '镌'],
  ['鏈', '链'], ['鏘', '锵'], ['鏟', '铲'], ['鏡', '镜'], ['鏢', '镖'], ['鏤', '镂'], ['鏽', '锈'], ['鐐', '镣'], ['鐲', '镯'], ['鐳', '镭'],
  ['鐺', '铛'], ['鑄', '铸'], ['鑑', '鉴'], ['鑒', '鉴'], ['鑲', '镶'], ['鑼', '锣'], ['鑽', '钻'], ['鑾', '銮'], ['鑿', '凿'], ['閂', '闩'],
  ['閉', '闭'], ['問', '问'], ['闖', '闯'], ['閏', '闰'], ['閑', '闲'], ['間', '间'], ['悶', '闷'], ['閘', '闸'], ['閨', '闺'], ['聞', '闻'],
  ['閥', '阀'], ['閣', '阁'], ['閡', '阂'], ['閱', '阅'], ['閹', '阉'], ['閻', '阎'], ['闡', '阐'], ['闌', '阑'], ['闔', '阖'], ['關', '关'],
  ['闢', '辟'], ['陣', '阵'], ['階', '阶'], ['際', '际'], ['陸', '陆'], ['隴', '陇'], ['陝', '陕'], ['陞', '升'], ['隊', '队'], ['隨', '随'],
  ['隱', '隐'], ['隕', '陨'], ['險', '险'], ['隸', '隶'], ['隻', '只'], ['雛', '雏'], ['雞', '鸡'], ['靂', '雳'], ['靄', '霭'], ['鞏', '巩'],
  ['韆', '千'], ['韌', '韧'], ['韜', '韬'], ['韻', '韵'], ['頃', '顷'], ['項', '项'], ['頌', '颂'], ['預', '预'], ['頑', '顽'], ['頒', '颁'],
  ['頗', '颇'], ['頜', '颌'], ['頡', '颉'], ['頤', '颐'], ['頰', '颊'], ['頸', '颈'], ['頹', '颓'], ['頻', '频'], ['顆', '颗'], ['題', '题'],
  ['額', '额'], ['顎', '颚'], ['顛', '颠'], ['顥', '颢'], ['顫', '颤'], ['顰', '颦'], ['顱', '颅'], ['飢', '饥'], ['飪', '饪'], ['飭', '饬'],
  ['飼', '饲'], ['餃', '饺'], ['餉', '饷'], ['養', '养'], ['餌', '饵'], ['餒', '馁'], ['餚', '肴'], ['餛', '馄'], ['餞', '饯'], ['餡', '馅'],
  ['餵', '喂'], ['餾', '馏'], ['饅', '馒'], ['饋', '馈'], ['饌', '馔'], ['饑', '饥'], ['饞', '馋'], ['馭', '驭'], ['馮', '冯'], ['馱', '驮'],
  ['馳', '驰'], ['馴', '驯'], ['駁', '驳'], ['駒', '驹'], ['駝', '驼'], ['罵', '骂'], ['駭', '骇'], ['駱', '骆'], ['駿', '骏'], ['騁', '骋'],
  ['騏', '骐'], ['驀', '蓦'], ['驃', '骠'], ['驍', '骁'], ['驛', '驿'], ['驟', '骤'], ['驢', '驴'], ['驤', '骧'], ['驥', '骥'], ['驪', '骊'],
  ['骯', '肮'], ['髏', '髅'], ['髒', '脏'], ['鬍', '胡'], ['鬚', '须'], ['鬢', '鬓'], ['魘', '魇'], ['魎', '魉'], ['鮑', '鲍'], ['鮭', '鲑'],
  ['鯉', '鲤'], ['鯊', '鲨'], ['鯤', '鲲'], ['鯧', '鲳'], ['鯰', '鲇'], ['鯽', '鲫'], ['鰈', '鲽'], ['鰍', '鳅'], ['鰐', '鳄'], ['鰓', '鳃'],
  ['鰭', '鳍'], ['鰱', '鲢'], ['鰲', '鳌'], ['鰻', '鳗'], ['鱈', '鳕'], ['鱉', '鳖'], ['鱔', '鳝'], ['鱗', '鳞'], ['鱷', '鳄'], ['鱸', '鲈'],
  ['鳩', '鸠'], ['鳶', '鸢'], ['鴉', '鸦'], ['鶯', '莺'], ['鴦', '鸯'], ['鴨', '鸭'], ['鴿', '鸽'], ['鸞', '鸾'], ['鵑', '鹃'], ['鵡', '鹉'],
  ['鵪', '鹌'], ['鵬', '鹏'], ['鵲', '鹊'], ['鶘', '鹕'], ['鶚', '鹗'], ['鶴', '鹤'], ['鶻', '鹘'], ['鷂', '鹞'], ['鷄', '鸡'], ['鷓', '鹧'],
  ['鷗', '鸥'], ['鷲', '鹫'], ['鷺', '鹭'], ['鸚', '鹦'], ['鸛', '鹳'], ['鸝', '鹂'], ['鹹', '咸'], ['鹼', '碱'], ['麩', '麸'],
  ['麵', '面'], ['黴', '霉'], ['鼇', '鳌'], ['齋', '斋'], ['齟', '龃'], ['齬', '龉'], ['齲', '龋'], ['齷', '龌'], ['龔', '龚'], ['龕', '龛'],
];

const TRAD_TO_SIMP_MAP = new Map<string, string>();
for (const [trad, simp] of TRAD_SIMP_TUPLES) {
  if (trad && simp && trad !== simp) {
    TRAD_TO_SIMP_MAP.set(trad, simp);
  }
}

export function toSimplifiedChinese(input: string): string {
  if (!input) return '';
  let out = '';
  for (const ch of input) {
    out += TRAD_TO_SIMP_MAP.get(ch) ?? ch;
  }
  return out;
}

// ── 2. Pinyin Full Syllable & Initials Engine ──
const PINYIN_SYLLABLE_DICT: Record<string, string> = {
  a: '阿啊呵腌吖',
  ai: '爱哀埃哎唉挨皑癌矮蔼艾碍暧捱',
  an: '安俺按暗岸胺案肮昂盎',
  ao: '凹敖熬翱袄傲奥懊澳',
  ba: '八巴扒叭芭疤捌笆拔跋把靶坝爸罢霸',
  bai: '白百柏摆败拜稗',
  ban: '班般颁斑搬板版扮拌伴瓣半办绊',
  bang: '邦帮梆榜膀绑棒傍谤镑',
  bao: '包苞胞褒雹宝饱保堡报抱豹暴爆薄',
  bei: '杯碑悲卑北贝备背钡倍狈被惫辈焙',
  ben: '奔本笨崩绷甭泵蹦',
  bi: '逼鼻比鄙笔彼碧蓖蔽毕毙毖币庇痹闭敝弊必辟壁臂避陛',
  bian: '鞭边编贬扁便变卞辨辩辫遍',
  biao: '标彪膘表',
  bie: '憋别瘪蹩',
  bin: '彬斌濒滨宾摈兵冰柄丙秉饼炳病并',
  bo: '拨波玻剥播脖菠伯驳帛泊勃搏铂箔博勃膊魄薄卜',
  bu: '补捕不布步簿部怖',
  ca: '擦猜裁材才财睬踩采彩菜蔡',
  can: '餐参蚕残惭惨灿苍舱仓沧藏',
  cao: '操糙槽曹草',
  ce: '厕策侧册测层蹭',
  cha: '插叉茬茶查碴搽察岔差诧刹',
  chai: '拆柴豺搀掺蝉馋谗缠铲产阐颤',
  chang: '昌猖场尝常长偿肠厂敞畅唱倡',
  chao: '超抄钞朝嘲潮巢吵炒',
  che: '车扯彻掣撤澈',
  chen: '郴臣辰尘晨忱沉陈趁衬称',
  cheng: '撑城橙成呈乘程惩澄诚承逞骋秤',
  chi: '吃痴持匙池迟弛驰耻齿侈尺赤翅斥炽',
  chong: '充冲虫崇宠',
  chou: '抽酬畴踌稠愁筹仇绸瞅丑臭',
  chu: '初出橱厨躇锄雏滁除楚础储矗搐触处',
  chuan: '揣川穿椽传船喘串',
  chuang: '疮窗床闯创',
  chui: '吹炊捶锤垂',
  chun: '春椿醇唇淳纯蠢',
  chuo: '戳绰疵茨磁雌辞慈瓷词此刺赐次',
  cong: '聪葱囱匆从丛',
  cou: '凑粗醋簇促蹿篡窜摧崔催脆瘁粹淬翠村存寸磋撮搓措挫错',
  da: '搭达答瘩打大',
  dai: '呆歹傣戴带殆代贷袋待逮怠',
  dan: '耽担丹单郸掸胆旦氮但惮淡诞弹蛋',
  dang: '当挡党荡档',
  dao: '刀捣蹈倒岛祷导到稻悼道盗',
  de: '德得的蹬灯登等瞪凳邓',
  di: '堤低滴迪敌笛狄涤翟嫡抵底地蒂第帝弟递缔',
  dian: '颠掂滇碘点典靛垫电佃甸店惦奠淀殿',
  diao: '碉叼雕凋刁掉吊钓调',
  die: '跌爹碟蝶迭谍叠',
  ding: '丁盯叮钉顶鼎锭定订',
  diu: '丢东冬董懂动栋侗恫冻洞',
  dou: '兜抖斗陡豆逗痘',
  du: '都督毒犊独读堵睹赌杜镀肚度渡妒',
  duan: '端短锻段断缎',
  dui: '堆兑队对墩吨蹲敦顿囤钝盾遁',
  duo: '掇哆多夺垛躲朵跺舵剁惰堕',
  e: '蛾峨鹅俄额讹娥恶厄扼遏鄂饿',
  en: '恩而儿耳尔饵洱二贰',
  fa: '发罚筏伐乏阀法珐',
  fan: '藩帆番翻樊矾钒繁凡烦反返范贩犯饭泛',
  fang: '坊芳方肪房防妨仿访纺放',
  fei: '菲非啡飞肥匪诽吠肺废沸费',
  fen: '芬酚吩氛分纷坟焚汾粉奋份忿愤粪',
  feng: '丰封枫蜂峰锋风疯烽逢冯缝讽奉凤',
  fo: '佛否夫敷肤孵扶拂辐幅氟符伏俘服浮涪福袱弗甫抚辅俯釜斧脯腑腐赴副覆赋复傅付阜父腹负富讣附妇缚咐',
  ga: '噶嘎该改概钙盖溉干甘杆柑竿肝赶感秆敢赣',
  gang: '冈刚钢缸肛纲岗港杠',
  gao: '篙皋高膏羔糕搞镐稿告',
  ge: '哥歌搁戈鸽胳疙割革葛格蛤阁隔铬个各',
  gei: '给根跟耕更庚羹埂耿梗',
  gong: '工攻功恭龚供躬公宫弓巩汞拱贡共',
  gou: '钩勾沟苟狗垢构购够',
  gu: '辜菇咕箍估沽孤姑鼓古蛊骨谷股故顾固雇',
  gua: '刮瓜剐寡挂褂乖拐怪棺关官冠观管馆罐惯灌贯',
  guang: '光广逛',
  gui: '瑰规圭硅归龟闺轨鬼诡癸桂柜跪贵刽',
  gun: '辊滚棍锅郭国果裹过哈',
  hai: '骸孩海氦亥害骇',
  han: '酣憨邯韩含涵寒函喊罕翰撼捍旱憾悍焊汗汉晗',
  hang: '夯杭航壕嚎豪毫郝好耗号浩',
  he: '呵喝荷菏核禾和何合盒貉阂河涸赫褐鹤贺',
  hei: '嘿黑痕很狠恨哼亨横衡恒轰哄烘虹鸿洪宏弘红',
  hou: '喉侯猴吼厚候后',
  hu: '呼乎忽瑚壶葫胡蝴狐糊湖弧虎唬护互沪户',
  hua: '花哗华猾滑画划化话桦',
  huai: '槐徊怀淮坏',
  huan: '欢环桓还缓换患唤痪豢焕涣宦幻',
  huang: '荒慌黄磺蝗簧皇凰惶煌晃幌恍谎',
  hui: '灰挥辉徽恢蛔回毁悔慧卉惠晦贿秽会烩汇讳诲绘',
  hun: '荤昏婚魂浑混豁活伙火获或惑霍货祸',
  ji: '击圾基机畸稽积箕肌饥迹激讥鸡姬绩缉吉极棘辑籍集及急疾汲即嫉级挤几脊己蓟技冀季伎祭剂悸济寄寂计记既忌际妓继纪',
  jia: '嘉枷夹佳家加荚颊贾甲钾假稼价架驾嫁',
  jian: '歼监坚尖笺间煎兼肩艰奸缄茧检柬碱硷拣捡简俭剪减荐槛鉴践贱见键箭件健舰剑饯渐溅涧建',
  jiang: '僵姜将浆江疆蒋桨奖讲匠酱降',
  jiao: '蕉椒礁焦胶交郊浇骄娇嚼搅铰矫侥脚狡角饺缴绞剿教酵轿较叫窖',
  jie: '揭接皆秸街阶截劫节桔杰捷睫竭洁结解姐戒藉芥界借介疥诫届',
  jin: '巾筋斤金今津襟紧锦仅谨进靳晋禁近烬浸尽劲',
  jing: '荆兢茎睛晶鲸京惊精粳经井警景颈静境敬镜径痉靖竟竞净',
  jiong: '炯窘揪究纠玖韭久灸九酒厩救旧臼舅咎就疚',
  ju: '鞠拘狙疽居驹菊局咀矩举沮聚拒据巨具距踞锯俱句惧炬剧',
  juan: '捐鹃娟倦眷卷绢撅攫抉掘倔爵觉决诀绝',
  jun: '均菌钧军君峻俊竣浚郡骏',
  ka: '喀咖卡咯开揩楷凯慨刊堪勘坎砍看康慷糠扛抗亢炕考拷烤靠',
  ke: '坷苛柯棵磕颗科壳咳可渴克刻客课',
  ken: '肯啃垦恳坑吭空恐孔控抠口扣寇枯哭窟苦酷库裤夸垮挎跨胯块筷侩快宽款匡筐狂框矿眶旷况亏盔岿窥葵奎魁傀馈愧溃坤昆捆困',
  kuo: '括扩廓阔',
  la: '垃拉喇蜡腊辣啦莱来赖蓝婪栏拦篮阑兰澜谰揽览懒缆烂滥琅榔狼廊郎朗浪捞劳牢老佬姥酪烙涝',
  le: '勒乐雷镭蕾磊累儡垒擂肋类泪',
  leng: '棱楞冷厘梨犁黎篱狸离漓理李里鲤礼莉荔吏栗丽厉励砾历利傈例俐痢立粒沥隶力璃哩',
  lian: '俩联莲连镰廉怜涟帘敛脸链恋炼练',
  liang: '粮凉梁粱良两辆量晾亮谅',
  liao: '撩聊僚疗燎寥辽潦了撂镣廖料',
  lie: '列裂烈劣猎琳林磷霖临邻鳞淋凛赁吝拎',
  ling: '玲菱零龄铃伶羚凌灵陵岭领另令',
  liu: '溜琉榴硫馏留刘瘤流柳六',
  long: '龙聋咙笼窿隆垄拢陇泷',
  lou: '楼娄搂篓漏陋芦卢颅庐炉掳卤虏鲁麓碌露路赂鹿潞禄录陆戮驴吕铝侣旅履屡缕虑氯律率滤绿',
  luan: '峦挛孪滦卵乱掠略抡轮伦仑沦纶论萝螺罗逻锣箩骡裸落洛骆络',
  ma: '妈麻玛码蚂马骂嘛吗埋买麦卖迈脉瞒馒蛮满蔓曼慢漫谩芒茫盲氓忙莽猫茅锚毛矛铆卯茂冒帽貌贸么',
  mei: '玫枚梅酶霉煤没眉媒镁每美昧寐妹媚',
  men: '门闷们萌蒙檬盟锰猛梦孟眯醚靡糜迷谜弥米秘觅泌蜜密幂棉眠绵冕免勉娩缅面苗描瞄藐秒渺庙妙蔑灭民抿皿敏悯闽明螟鸣铭名命谬',
  mo: '摸摹蘑模膜磨摩魔抹末莫墨默沫漠寞陌谋牟某母亩牡姆拇木目穆牧幕慕暮',
  na: '拿哪呐钠那娜纳氖乃奶耐奈南男难囊挠脑恼闹淖呢馁内嫩能妮霓倪泥尼拟你匿腻逆溺蔫拈年碾撵捻念娘酿鸟尿捏聂孽啮镊镍涅您柠狞凝宁拧泞牛扭钮纽脓浓农弄奴努怒女暖虐疟挪懦糯诺',
  ou: '哦欧鸥殴藕呕偶沤啪趴爬帕怕琶拍排牌徘湃派攀潘盘磐盼畔判叛乓庞旁耪胖抛咆刨炮袍跑泡呸胚培裴赔陪配佩沛喷盆砰抨烹澎彭蓬棚硼篷膨朋鹏捧碰坯砒霹批披劈琵毗啤脾疲皮匹痞僻屁譬篇偏片骗飘漂瓢票撇瞥拼频贫品聘乒坪苹萍平凭瓶评屏坡泼颇婆破魄迫粕剖扑铺仆莆葡菩蒲埔朴圃普浦谱曝瀑',
  qi: '期欺栖戚妻七凄漆柒沏其棋奇歧畦崎脐齐旗祈祁骑起岂乞企启契砌器气迄弃汽泣讫',
  qia: '掐恰洽牵扦钎铅千迁签仟谦乾黔钱钳前潜遣浅谴堑嵌欠歉',
  qiang: '枪呛腔羌墙蔷强抢',
  qiao: '橇锹敲悄桥瞧乔侨巧鞘撬翘峭俏窍',
  qie: '切茄且怯窃钦侵亲秦琴勤芹擒禽寝沁',
  qing: '青轻氢倾卿清擎晴氰情顷请庆',
  qiong: '琼穷秋丘邱球求囚酋泅趋区蛆曲躯屈驱渠取娶龋趣去圈颧权醛泉全痊拳犬券劝缺炔瘸却鹊榷确雀裙群',
  ran: '然燃冉染瓤壤攘嚷让饶扰绕惹热壬仁人忍韧任认刃妊纫扔仍日戎茸蓉荣融熔溶容绒冗揉柔肉茹蠕儒孺如辱乳汝入褥软阮蕊瑞锐闰润若弱',
  sa: '撒洒萨腮鳃塞赛三叁伞散桑嗓丧搔骚扫嫂瑟色涩森僧莎砂杀刹沙纱傻啥煞筛晒珊苫杉山删煽衫闪陕擅赡膳善汕扇缮墒伤商赏晌上尚裳梢捎稍烧芍勺韶少哨邵绍奢赊蛇舌舍赦摄射慑涉社设砷申呻伸身深娠绅神沈审婶甚肾慎渗声生甥牲升绳省盛剩胜圣师失狮施湿诗尸虱十石拾时什食蚀实识史矢使屎驶始式示士世柿事拭誓逝势是嗜噬适仕侍释饰氏市恃室视试收手首守寿授售受瘦兽蔬枢梳殊抒输叔舒淑疏书赎孰熟薯暑曙署蜀黍鼠属术述树束戍竖墅庶数漱恕刷耍摔衰甩帅栓拴霜双爽谁水睡税吮瞬顺舜说硕朔烁斯撕嘶思私司丝死肆寺嗣四伺似饲巳松耸怂颂送宋讼诵搜艘擞嗽苏酥俗素速粟僳塑溯宿诉肃酸蒜算虽隋随绥髓碎岁穗遂隧祟孙损笋蓑梭唆缩琐索锁所塌他它她塔獭挞蹋踏胎苔抬台泰酞太态汰坍摊贪瘫滩坛檀痰潭谭谈坦毯袒碳探叹炭汤塘搪堂棠膛唐糖倘躺淌趟烫掏涛滔绦萄桃逃淘陶讨套特藤腾疼誊梯剔踢锑提题蹄啼体替嚏惕涕剃屉',
  tian: '天添填田甜恬舔腆',
  tiao: '挑条迢眺跳贴铁帖厅听烃汀廷停亭庭挺艇通桐酮瞳同铜彤童桶捅筒统痛偷投头透凸秃突图徒途涂屠土吐兔湍团推颓腿蜕褪退吞屯臀拖托脱鸵陀驮驼椭妥拓唾',
  wa: '挖哇蛙洼娃瓦袜歪外豌弯湾玩顽丸烷完碗挽晚皖惋宛婉万腕汪王亡枉网往旺望忘妄威巍微危韦违桅围唯惟为潍维苇萎委伟伪尾纬未蔚味畏胃喂魏位渭谓尉慰卫瘟温蚊文闻纹吻稳紊问嗡翁瓮挝蜗涡窝我斡卧握沃巫呜钨乌污诬屋无芜梧吾吴毋武五捂午舞伍侮坞戊雾晤物勿务悟误',
  xi: '昔熙析西硒矽晰嘻吸锡牺稀息希悉膝夕惜熄烯溪汐犀檄袭席习媳喜铣洗系隙戏细',
  xia: '瞎虾匣霞辖暇峡侠狭下厦夏吓',
  xian: '掀锨先仙鲜纤咸贤衔舷闲涎弦嫌显险现献县腺馅羡宪陷限线',
  xiang: '相厢镶香箱襄湘乡翔祥详想响享项巷橡像向象',
  xiao: '萧硝霄削哮嚣销消宵淆晓小孝校肖啸笑效',
  xie: '楔些歇蝎鞋协挟携邪斜胁谐写械卸蟹懈泄泻谢屑',
  xin: '薪芯锌欣辛新忻心信衅',
  xing: '星腥猩惺兴刑型形邢行醒幸杏性姓',
  xiong: '兄凶胸匈汹雄熊休修羞朽嗅锈秀袖绣墟戌需虚嘘须徐许蓄酗叙旭序畜恤絮婿绪续轩喧宣悬旋玄选癣眩绚靴薛学穴雪血勋熏循旬询寻驯巡殉汛训讯逊迅',
  ya: '压押鸦鸭呀丫芽牙蚜崖衙涯雅哑亚讶焉咽阉烟淹盐严研蜒岩延言颜阎炎沿奄掩眼衍演艳堰燕厌砚雁唁彦焰宴谚验',
  yang: '殃央鸯秧杨扬佯疡羊洋阳氧仰痒养样漾',
  yao: '邀腰妖瑶摇尧遥窑谣姚咬舀药要耀',
  ye: '椰噎耶爷野冶也页业叶曳腋夜液',
  yi: '一壹医揖铱依伊衣颐夷遗移仪胰疑沂宜姨彝椅蚁倚已乙矣以艺抑易邑屹亿役臆逸肄疫亦裔意毅忆义益溢诣议谊译异翼翌绎奕',
  yin: '茵荫因殷音阴姻吟银淫寅饮尹引隐印',
  ying: '英樱婴鹰应缨莹萤营荧蝇迎赢盈影颖硬映',
  yo: '哟拥佣臃痈庸雍踊蛹咏泳涌永恿勇用幽优悠忧尤由邮铀犹油游酉有友右佑釉诱又幼迂淤于盂榆虞愚舆余俞逾鱼愉渝渔隅予娱雨与屿禹宇语羽玉域芋郁吁遇喻峪御愈欲狱育誉浴寓裕预豫驭鸳渊冤元垣袁原援辕园员圆猿源缘远苑愿怨院曰约越跃钥岳粤月悦阅耘云郧匀陨允运蕴酝晕韵孕匝砸杂栽哉灾宰载再在咱攒暂赞赃脏葬遭糟凿藻枣早澡蚤躁噪造皂灶燥责择则泽贼怎增憎曾赠扎喳渣札轧铡闸眨栅榨咋乍炸诈摘斋宅窄债寨瞻毡詹粘沾盏斩辗崭展蘸栈占战站湛绽樟章彰漳张掌涨杖丈帐账仗胀瘴障招昭找沼赵照罩兆肇召遮折哲蛰辙者锗蔗这浙珍斟真甄砧臻贞针侦枕疹诊震振镇阵蒸挣睁征狰争怔整拯正政帧症郑证芝枝支吱蜘知肢脂汁之织职直植殖执值侄址指止趾只旨纸志挚掷至致置帜峙制智秩稚质炙痔滞治窒',
  zhong: '中盅忠钟衷终种肿重仲众',
  zhou: '舟周州洲诌粥轴肘帚咒皱宙昼骤',
  zhu: '珠株蛛朱猪诸诛逐竹烛煮拄瞩嘱主著柱助蛀贮铸筑住注祝驻抓爪拽专砖转撰赚篆桩庄装妆撞壮状椎锥追赘坠缀谆准捉拙卓桌琢茁酌啄着灼浊兹咨资姿滋淄孜紫仔籽滓子自渍字鬃棕踪宗综总纵邹走奏揍租足卒族祖诅阻组钻纂嘴醉最罪尊遵昨左佐柞做作坐座',
};

const CHAR_TO_PINYIN = new Map<string, string>();
for (const [syllable, chars] of Object.entries(PINYIN_SYLLABLE_DICT)) {
  for (const ch of chars) {
    if (!CHAR_TO_PINYIN.has(ch)) {
      CHAR_TO_PINYIN.set(ch, syllable);
    }
  }
}
// Override multi-pronunciation characters common in music titles/artists
const MUSIC_PINYIN_OVERRIDES: Array<[string, string]> = [
  ['周', 'zhou'], ['杰', 'jie'], ['伦', 'lun'], ['晴', 'qing'], ['天', 'tian'],
  ['林', 'lin'], ['俊', 'jun'], ['陈', 'chen'], ['奕', 'yi'], ['迅', 'xun'],
  ['邓', 'deng'], ['紫', 'zi'], ['棋', 'qi'], ['王', 'wang'], ['菲', 'fei'],
  ['陶', 'tao'], ['喆', 'zhe'], ['力', 'li'], ['宏', 'hong'], ['方', 'fang'],
  ['大', 'da'], ['同', 'tong'], ['五', 'wu'], ['月', 'yue'], ['孙', 'sun'],
  ['燕', 'yan'], ['姿', 'zi'], ['蔡', 'cai'], ['依', 'yi'], ['张', 'zhang'],
  ['学', 'xue'], ['友', 'you'], ['刘', 'liu'], ['德', 'de'], ['华', 'hua'],
  ['国', 'guo'], ['荣', 'rong'], ['莫', 'mo'], ['文', 'wen'], ['蔚', 'wei'],
  ['李', 'li'], ['浩', 'hao'], ['薛', 'xue'], ['之', 'zhi'], ['谦', 'qian'],
  ['毛', 'mao'], ['不', 'bu'], ['易', 'yi'], ['深', 'shen'], ['惠', 'hui'],
  ['妹', 'mei'], ['田', 'tian'], ['馥', 'fu'], ['甄', 'zhen'], ['苏', 'su'],
  ['打', 'da'], ['绿', 'lv'], ['草', 'cao'], ['东', 'dong'], ['没', 'mei'],
  ['有', 'you'], ['派', 'pai'], ['对', 'dui'], ['告', 'gao'], ['人', 'ren'],
  ['朴', 'pu'], ['树', 'shu'], ['许', 'xu'], ['巍', 'wei'], ['赵', 'zhao'],
  ['雷', 'lei'], ['米', 'mi'], ['津', 'jin'], ['玄', 'xuan'], ['师', 'shi'],
  ['宇', 'yu'], ['多', 'duo'], ['光', 'guang'], ['久', 'jiu'], ['石', 'shi'],
  ['让', 'rang'], ['坂', 'ban'], ['本', 'ben'], ['龙', 'long'], ['一', 'yi'],
  ['海', 'hai'], ['阔', 'kuo'], ['空', 'kong'], ['七', 'qi'], ['里', 'li'],
  ['香', 'xiang'], ['稻', 'dao'], ['夜', 'ye'], ['曲', 'qu'], ['青', 'qing'],
  ['花', 'hua'], ['瓷', 'ci'], ['白', 'bai'], ['气', 'qi'], ['球', 'qiu'],
  ['年', 'nian'], ['外', 'wai'], ['泡', 'pao'], ['沫', 'mo'], ['起', 'qi'],
  ['风', 'feng'], ['了', 'le'], ['演', 'yan'], ['员', 'yuan'], ['体', 'ti'],
  ['面', 'mian'], ['孤', 'gu'], ['勇', 'yong'], ['者', 'zhe'], ['十', 'shi'],
  ['单', 'dan'], ['车', 'che'], ['浮', 'fu'], ['夸', 'kua'], ['富', 'fu'],
  ['士', 'shi'], ['山', 'shan'], ['下', 'xia'], ['喜', 'xi'], ['帖', 'tie'],
  ['街', 'jie'], ['红', 'hong'], ['豆', 'dou'], ['温', 'wen'], ['柔', 'rou'],
  ['倔', 'jue'], ['强', 'qiang'], ['知', 'zhi'], ['足', 'zu'], ['后', 'hou'],
  ['来', 'lai'], ['遇', 'yu'], ['见', 'jian'], ['修', 'xiu'], ['炼', 'lian'],
  ['爱', 'ai'], ['情', 'qing'], ['江', 'jiang'], ['南', 'nan'], ['平', 'ping'],
  ['凡', 'fan'], ['路', 'lu'], ['成', 'cheng'], ['都', 'dou'], ['鱼', 'yu'],
  ['消', 'xiao'], ['愁', 'chou'], ['乐', 'yue'], ['行', 'xing'], ['重', 'chong'],
  ['长', 'chang'], ['弹', 'tan'], ['调', 'diao'], ['曲', 'qu'], ['藏', 'cang'],
];
for (const [ch, py] of MUSIC_PINYIN_OVERRIDES) {
  CHAR_TO_PINYIN.set(ch, py);
}

// Collator fallback for rare CJK characters
const COLLATOR_BOUNDARIES: Array<[string, string]> = [
  ['阿', 'a'], ['八', 'b'], ['嚓', 'c'], ['哒', 'd'], ['妸', 'e'], ['发', 'f'],
  ['旮', 'g'], ['哈', 'h'], ['讥', 'j'], ['咔', 'k'], ['垃', 'l'], ['妈', 'm'],
  ['拿', 'n'], ['哦', 'o'], ['啪', 'p'], ['期', 'q'], ['然', 'r'], ['撒', 's'],
  ['塌', 't'], ['挖', 'w'], ['昔', 'x'], ['压', 'y'], ['匝', 'z'],
];
let zhCollator: Intl.Collator | null | undefined;
const rareInitialCache = new Map<string, string>();

function getRareCharInitial(ch: string): string {
  const cached = rareInitialCache.get(ch);
  if (cached !== undefined) return cached;
  if (zhCollator === undefined) {
    try {
      zhCollator = new Intl.Collator('zh-Hans-u-co-pinyin');
    } catch {
      zhCollator = null;
    }
  }
  if (!zhCollator) return '';
  let result = '';
  for (let i = COLLATOR_BOUNDARIES.length - 1; i >= 0; i--) {
    if (zhCollator.compare(ch, COLLATOR_BOUNDARIES[i][0]) >= 0) {
      result = COLLATOR_BOUNDARIES[i][1];
      break;
    }
  }
  if (rareInitialCache.size < 4096) {
    rareInitialCache.set(ch, result);
  }
  return result;
}

export interface PinyinInfo {
  full: string;
  initials: string;
  tokens: string[];
}

export function toPinyinInfo(input: string): PinyinInfo {
  if (!input) return { full: '', initials: '', tokens: [] };
  const simp = toSimplifiedChinese(input).toLowerCase();
  const tokens: string[] = [];
  let initials = '';
  let asciiBuf = '';

  const flushAscii = () => {
    if (asciiBuf) {
      tokens.push(asciiBuf);
      initials += asciiBuf[0];
      asciiBuf = '';
    }
  };

  for (const ch of simp) {
    const code = ch.charCodeAt(0);
    if ((code >= 97 && code <= 122) || (code >= 48 && code <= 57)) {
      asciiBuf += ch;
      continue;
    }
    flushAscii();
    if (code >= 0x4e00 && code <= 0x9fff) {
      const py = CHAR_TO_PINYIN.get(ch);
      if (py) {
        tokens.push(py);
        initials += py[0];
      } else {
        const init = getRareCharInitial(ch);
        if (init) {
          tokens.push(init);
          initials += init;
        }
      }
    }
  }
  flushAscii();

  return {
    full: tokens.join(''),
    initials,
    tokens,
  };
}

// ── 3. Artist Alias Dictionary, Genre Priors & Cold-Start Related Graph ──
interface ArtistCatalogEntry {
  canonical: string;
  aliases: string[];
  genres: string[];
  language: InferredLanguage;
  related: string[];
}

const ARTIST_KNOWLEDGE_BASE: ArtistCatalogEntry[] = [
  {
    canonical: '周杰伦',
    aliases: ['jay chou', 'jaychou', 'jay', '周董', 'zhoujielun', 'zhou jie lun'],
    genres: ['mandopop', 'r&b', 'c-pop', 'pop'],
    language: 'zh',
    related: ['林俊杰', '王力宏', '陶喆', '方大同', '蔡依林', '五月天'],
  },
  {
    canonical: '林俊杰',
    aliases: ['jj lin', 'jjlin', 'jj', 'linjunjie', 'lin jun jie', '行走的cd'],
    genres: ['mandopop', 'r&b', 'ballad', 'pop'],
    language: 'zh',
    related: ['周杰伦', '王力宏', '陶喆', '孙燕姿', '邓紫棋', '薛之谦'],
  },
  {
    canonical: '陈奕迅',
    aliases: ['eason chan', 'easonchan', 'eason', '陈医生', 'chenyixun', 'chen yi xun'],
    genres: ['cantopop', 'mandopop', 'ballad', 'pop'],
    language: 'zh',
    related: ['张学友', '王菲', '容祖儿', '杨千嬅', '古巨基', '莫文蔚'],
  },
  {
    canonical: '邓紫棋',
    aliases: ['g.e.m.', 'gem', 'g.e.m', 'dengziqi', 'deng zi qi', 'gloria tang', '邓紫棋g.e.m.'],
    genres: ['mandopop', 'pop', 'r&b', 'rock'],
    language: 'zh',
    related: ['林俊杰', '周杰伦', '张靓颖', '蔡依林', '李荣浩'],
  },
  {
    canonical: '王菲',
    aliases: ['faye wong', 'fayewong', '王靖雯', 'wangfei'],
    genres: ['mandopop', 'cantopop', 'dream-pop', 'ballad'],
    language: 'zh',
    related: ['陈奕迅', '孙燕姿', '莫文蔚', '那英', '张学友'],
  },
  {
    canonical: '陶喆',
    aliases: ['david tao', 'davidtao', 'taozhe'],
    genres: ['r&b', 'mandopop', 'soul'],
    language: 'zh',
    related: ['周杰伦', '王力宏', '方大同', '林俊杰'],
  },
  {
    canonical: '王力宏',
    aliases: ['leehom wang', 'leehom', 'wanglihong'],
    genres: ['mandopop', 'r&b', 'pop'],
    language: 'zh',
    related: ['周杰伦', '陶喆', '林俊杰', '方大同'],
  },
  {
    canonical: '方大同',
    aliases: ['khalil fong', 'khalil', 'fangdatong'],
    genres: ['r&b', 'soul', 'mandopop'],
    language: 'zh',
    related: ['陶喆', '周杰伦', '王力宏', '林俊杰', '袁娅维'],
  },
  {
    canonical: '五月天',
    aliases: ['mayday', 'wuyuetian', '阿信'],
    genres: ['rock', 'mandopop', 'pop-rock'],
    language: 'zh',
    related: ['苏打绿', '告五人', '孙燕姿', '周杰伦', '梁静茹'],
  },
  {
    canonical: 'Beyond',
    aliases: ['beyond', 'beyond乐队', '黄家驹', 'wong ka kui'],
    genres: ['rock', 'cantopop', 'classic-rock'],
    language: 'yue',
    related: ['张学友', '张国荣', '谭咏麟', '陈奕迅', '五月天'],
  },
  {
    canonical: '孙燕姿',
    aliases: ['stefanie sun', 'stefaniesun', 'sunyanzi'],
    genres: ['mandopop', 'pop', 'ballad'],
    language: 'zh',
    related: ['梁静茹', '蔡依林', '王菲', '林俊杰', '田馥甄'],
  },
  {
    canonical: '蔡依林',
    aliases: ['jolin tsai', 'jolin', 'caiyilin'],
    genres: ['mandopop', 'dance-pop', 'pop'],
    language: 'zh',
    related: ['周杰伦', '孙燕姿', '萧亚轩', '张惠妹', '邓紫棋'],
  },
  {
    canonical: '张学友',
    aliases: ['jacky cheung', 'jackycheung', '歌神', 'zhangxueyou'],
    genres: ['cantopop', 'mandopop', 'ballad'],
    language: 'yue',
    related: ['刘德华', '张国荣', '陈奕迅', '黎明', '郭富城'],
  },
  {
    canonical: '张国荣',
    aliases: ['leslie cheung', 'leslie', 'zhangguorong'],
    genres: ['cantopop', 'classic', 'ballad'],
    language: 'yue',
    related: ['张学友', '梅艳芳', '王菲', '陈奕迅', 'Beyond'],
  },
  {
    canonical: '李荣浩',
    aliases: ['lironghao', 'ronghao li'],
    genres: ['mandopop', 'pop', 'indie-pop'],
    language: 'zh',
    related: ['薛之谦', '毛不易', '林俊杰', '方大同', '杨丞琳'],
  },
  {
    canonical: '薛之谦',
    aliases: ['joker xue', 'jokerxue', 'xuezhiqian'],
    genres: ['mandopop', 'ballad', 'pop'],
    language: 'zh',
    related: ['李荣浩', '毛不易', '林俊杰', '陈奕迅'],
  },
  {
    canonical: '毛不易',
    aliases: ['maobuyi', 'mao buyi'],
    genres: ['folk', 'mandopop', 'ballad'],
    language: 'zh',
    related: ['赵雷', '朴树', '李荣浩', '周深', '薛之谦'],
  },
  {
    canonical: '周深',
    aliases: ['charlie zhou', 'zhoushen'],
    genres: ['mandopop', 'ballad', 'ost'],
    language: 'zh',
    related: ['毛不易', '王菲', '林俊杰', '张靓颖'],
  },
  {
    canonical: '朴树',
    aliases: ['pushu', 'pu shu'],
    genres: ['folk', 'rock', 'indie'],
    language: 'zh',
    related: ['许巍', '赵雷', '毛不易', '万能青年旅店'],
  },
  {
    canonical: '赵雷',
    aliases: ['zhaolei', 'zhao lei'],
    genres: ['folk', 'indie'],
    language: 'zh',
    related: ['朴树', '毛不易', '宋冬野', '陈粒', '许巍'],
  },
  {
    canonical: '苏打绿',
    aliases: ['sodagreen', '鱼丁糸', '吴青峰', 'sudalv'],
    genres: ['indie-pop', 'mandopop', 'rock'],
    language: 'zh',
    related: ['田馥甄', '五月天', '告五人', '陈绮贞'],
  },
  {
    canonical: '告五人',
    aliases: ['accusefive', 'gaowuren'],
    genres: ['indie-rock', 'mandopop', 'pop-rock'],
    language: 'zh',
    related: ['五月天', '苏打绿', '草东没有派对', '落日飞车'],
  },
  {
    canonical: '草东没有派对',
    aliases: ['no party for cao dong', 'caodong'],
    genres: ['indie-rock', 'rock'],
    language: 'zh',
    related: ['万能青年旅店', '告五人', '落日飞车'],
  },
  {
    canonical: 'Taylor Swift',
    aliases: ['taylor swift', 'taylorswift', '霉霉', 'taylor'],
    genres: ['pop', 'synth-pop', 'folk-pop'],
    language: 'en',
    related: ['Ed Sheeran', 'Ariana Grande', 'Billie Eilish', 'Adele', 'Olivia Rodrigo'],
  },
  {
    canonical: 'Ed Sheeran',
    aliases: ['ed sheeran', 'edsheeran', '黄老板'],
    genres: ['pop', 'folk-pop', 'acoustic'],
    language: 'en',
    related: ['Taylor Swift', 'Bruno Mars', 'Coldplay', 'Justin Bieber'],
  },
  {
    canonical: 'Bruno Mars',
    aliases: ['bruno mars', 'brunomars', '火星哥'],
    genres: ['r&b', 'funk', 'pop', 'soul'],
    language: 'en',
    related: ['The Weeknd', 'Ed Sheeran', 'Justin Bieber', 'Michael Jackson'],
  },
  {
    canonical: 'The Weeknd',
    aliases: ['the weeknd', 'weeknd', '盆栽哥'],
    genres: ['r&b', 'synth-pop', 'pop'],
    language: 'en',
    related: ['Bruno Mars', 'Ariana Grande', 'Billie Eilish', 'Drake'],
  },
  {
    canonical: 'Coldplay',
    aliases: ['coldplay', '酷玩', '酷玩乐队'],
    genres: ['pop-rock', 'alternative', 'rock'],
    language: 'en',
    related: ['Imagine Dragons', 'OneRepublic', 'Linkin Park', 'Ed Sheeran'],
  },
  {
    canonical: 'Adele',
    aliases: ['adele', '阿黛尔'],
    genres: ['soul', 'pop', 'ballad'],
    language: 'en',
    related: ['Taylor Swift', 'Sam Smith', 'Ed Sheeran', 'Bruno Mars'],
  },
  {
    canonical: 'Billie Eilish',
    aliases: ['billie eilish', 'billieeilish', '碧梨'],
    genres: ['indie-pop', 'electropop', 'pop'],
    language: 'en',
    related: ['Taylor Swift', 'Ariana Grande', 'The Weeknd', 'Lana Del Rey'],
  },
  {
    canonical: 'Imagine Dragons',
    aliases: ['imagine dragons', 'imaginedragons', '梦龙', '梦龙乐队'],
    genres: ['pop-rock', 'rock', 'alternative'],
    language: 'en',
    related: ['Coldplay', 'Linkin Park', 'OneRepublic'],
  },
  {
    canonical: 'Linkin Park',
    aliases: ['linkin park', 'linkinpark', '林肯公园'],
    genres: ['rock', 'alternative', 'nu-metal'],
    language: 'en',
    related: ['Imagine Dragons', 'Coldplay', 'Green Day'],
  },
  {
    canonical: 'YOASOBI',
    aliases: ['yoasobi', '夜游', 'ikura', 'ayase'],
    genres: ['j-pop', 'electronic', 'anime'],
    language: 'ja',
    related: ['米津玄师', 'RADWIMPS', '宇多田光', 'Aimer'],
  },
  {
    canonical: '米津玄师',
    aliases: ['kenshi yonezu', 'yonezu kenshi', '米津玄師', 'hachi'],
    genres: ['j-pop', 'rock', 'anime'],
    language: 'ja',
    related: ['YOASOBI', 'RADWIMPS', '宇多田光'],
  },
  {
    canonical: 'RADWIMPS',
    aliases: ['radwimps', '野田洋次郎'],
    genres: ['j-pop', 'rock', 'anime'],
    language: 'ja',
    related: ['米津玄师', 'YOASOBI', '久石让'],
  },
  {
    canonical: '久石让',
    aliases: ['joe hisaishi', 'joehisaishi', '久石譲'],
    genres: ['instrumental', 'classical', 'ost'],
    language: 'inst',
    related: ['坂本龙一', 'RADWIMPS'],
  },
  {
    canonical: '坂本龙一',
    aliases: ['ryuichi sakamoto', '坂本龍一'],
    genres: ['instrumental', 'classical', 'ambient'],
    language: 'inst',
    related: ['久石让'],
  },
  {
    canonical: 'IU',
    aliases: ['iu', '李知恩', '이지은', 'lee ji-eun'],
    genres: ['k-pop', 'ballad', 'pop'],
    language: 'ko',
    related: ['BLACKPINK', 'NewJeans', 'BIGBANG'],
  },
  {
    canonical: 'BLACKPINK',
    aliases: ['blackpink', 'black pink', '粉墨'],
    genres: ['k-pop', 'dance-pop', 'hip-hop'],
    language: 'ko',
    related: ['NewJeans', 'IU', 'BIGBANG'],
  },
  {
    canonical: 'NewJeans',
    aliases: ['newjeans', 'new jeans'],
    genres: ['k-pop', 'r&b', 'pop'],
    language: 'ko',
    related: ['BLACKPINK', 'IU'],
  },
];

const ALIAS_TO_ENTRY = new Map<string, ArtistCatalogEntry>();
for (const entry of ARTIST_KNOWLEDGE_BASE) {
  const keys = [entry.canonical, toSimplifiedChinese(entry.canonical), ...entry.aliases];
  for (const k of keys) {
    const clean = compactNormalize(k);
    if (clean) ALIAS_TO_ENTRY.set(clean, entry);
  }
}

export function compactNormalize(text: string): string {
  if (!text) return '';
  return toSimplifiedChinese(text)
    .toLowerCase()
    .replace(/[\s\-_—·.,!?'"`()[\]{}<>《》「」【】、/\\|+&:;]/g, '')
    .trim();
}

export function splitArtists(artistStr: string): string[] {
  if (!artistStr) return [];
  const cleaned = artistStr
    .replace(/\s*(?:feat\.?|ft\.?|featuring|with|×|x)\s+/gi, '/')
    .replace(/[、，,&+;|]/g, '/');
  const parts = cleaned
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [artistStr.trim()];
}

export function resolveCanonicalArtist(artistName: string): string {
  const primary = splitArtists(artistName)[0] || artistName || '';
  const simp = toSimplifiedChinese(primary).trim();
  const key = compactNormalize(simp);
  const found = ALIAS_TO_ENTRY.get(key);
  if (found) return found.canonical;
  // Also handle combined forms like "G.E.M.邓紫棋" or "周杰伦 (Jay Chou)"
  const strippedParen = simp.replace(/\s*[\(\[（【][^\)\]）】]*[\)\]）】]\s*/g, '').trim();
  const strippedKey = compactNormalize(strippedParen);
  if (strippedKey && ALIAS_TO_ENTRY.has(strippedKey)) {
    return ALIAS_TO_ENTRY.get(strippedKey)!.canonical;
  }
  for (const entry of ARTIST_KNOWLEDGE_BASE) {
    const cKey = compactNormalize(entry.canonical);
    if (cKey.length >= 2 && key.includes(cKey)) {
      return entry.canonical;
    }
  }
  return strippedParen || simp;
}

export function getArtistKnowledge(artistName: string): ArtistCatalogEntry | undefined {
  const canonical = resolveCanonicalArtist(artistName);
  return ALIAS_TO_ENTRY.get(compactNormalize(canonical));
}

export function getRelatedArtists(artistName: string): string[] {
  const entry = getArtistKnowledge(artistName);
  return entry ? [...entry.related] : [];
}

export function getArtistAliases(artistName: string): string[] {
  const entry = getArtistKnowledge(artistName);
  if (!entry) return [];
  return [entry.canonical, ...entry.aliases];
}

// ── 4. Query Alias, Genre & Pinyin Expansion ──
const GENRE_SYNONYMS: Array<{ canonical: string; terms: string[]; languages?: InferredLanguage[] }> = [
  { canonical: 'r&b', terms: ['r&b', 'rnb', '节奏布鲁斯', '华语r&b', '华语rnb'] },
  { canonical: 'mandopop', terms: ['华语', '华语流行', '国语', 'mandopop', 'c-pop', 'cpop', '中文流行'] },
  { canonical: 'cantopop', terms: ['粤语', '广东歌', '港乐', 'cantopop', 'hkpop'], languages: ['yue'] },
  { canonical: 'rock', terms: ['摇滚', 'rock', '乐队', '国摇', 'indie-rock', 'pop-rock'] },
  { canonical: 'folk', terms: ['民谣', 'folk', '吉他弹唱', '独立民谣'] },
  { canonical: 'electronic', terms: ['电子', '电音', 'edm', 'electronic', 'synth-pop', 'house'] },
  { canonical: 'hip-hop', terms: ['说唱', '嘻哈', 'rap', 'hip-hop', 'hiphop'] },
  { canonical: 'ballad', terms: ['抒情', '慢歌', '情歌', 'ballad', '伤感'] },
  { canonical: 'indie', terms: ['独立', 'indie', 'indie-pop', '小众'] },
  { canonical: 'j-pop', terms: ['日语', '日音', '二次元', '动漫', 'j-pop', 'jpop', 'anime'], languages: ['ja'] },
  { canonical: 'k-pop', terms: ['韩语', '韩流', 'k-pop', 'kpop'], languages: ['ko'] },
  { canonical: 'instrumental', terms: ['纯音乐', '轻音乐', '钢琴', '器乐', 'instrumental', 'classical', '古典', 'ost', '原声'], languages: ['inst'] },
  { canonical: 'pop', terms: ['流行', '欧美流行', 'pop'] },
];

export function extractQueryGenres(query: string): { genres: string[]; languages: InferredLanguage[] } {
  const qLower = toSimplifiedChinese(query).toLowerCase();
  const genres = new Set<string>();
  const languages = new Set<InferredLanguage>();
  for (const g of GENRE_SYNONYMS) {
    for (const term of g.terms) {
      if (qLower.includes(term)) {
        genres.add(g.canonical);
        g.languages?.forEach((l) => languages.add(l));
      }
    }
  }
  if (qLower.includes('华语') || qLower.includes('中文') || qLower.includes('国语')) {
    languages.add('zh');
  }
  if (qLower.includes('欧美') || qLower.includes('英文') || qLower.includes('英语')) {
    languages.add('en');
  }
  return { genres: Array.from(genres), languages: Array.from(languages) };
}

// Common Pinyin romanized song/artist queries -> Chinese rewrite for live upstream recall
const PINYIN_QUERY_REWRITES: Record<string, string> = {
  qingtian: '晴天',
  qilixiang: '七里香',
  daoxiang: '稻香',
  yequ: '夜曲',
  qinghuaci: '青花瓷',
  gaobaiqiqiu: '告白气球',
  jiandanai: '简单爱',
  haikuotiankong: '海阔天空',
  guanghuisuiyue: '光辉岁月',
  xihuanni: '喜欢你',
  zhendaini: '真的爱你',
  fushishanxia: '富士山下',
  shinian: '十年',
  fukua: '浮夸',
  guguozhe: '孤勇者',
  guyongzhe: '孤勇者',
  xitiejie: '喜帖街',
  guangnianzhiwai: '光年之外',
  paomo: '泡沫',
  qifengle: '起风了',
  yanyuan: '演员',
  timian: '体面',
  pingfanzhilu: '平凡之路',
  chengdu: '成都',
  dayu: '大鱼',
  xiaochou: '消愁',
  hongdou: '红豆',
  yujian: '遇见',
  houlai: '后来',
  wenrou: '温柔',
  juejiang: '倔强',
  turannaoxiangni: '突然好想你',
  turanhaoxiangni: '突然好想你',
  jiangnan: '江南',
  xiulianaiqing: '修炼爱情',
  keximeiruguo: '可惜没如果',
  zhoujielun: '周杰伦',
  linjunjie: '林俊杰',
  chenyixun: '陈奕迅',
  dengziqi: '邓紫棋',
  wangfei: '王菲',
  wuyuetian: '五月天',
  sunyanzi: '孙燕姿',
  caiyilin: '蔡依林',
  zhangxueyou: '张学友',
  xuezhiqian: '薛之谦',
  lironghao: '李荣浩',
  maobuyi: '毛不易',
  zhoushen: '周深',
};

export function expandQueryAliases(rawQuery: string): {
  simplified: string;
  compact: string;
  pinyinFull: string;
  pinyinInitials: string;
  expandedQueries: string[];
  matchedArtist?: string;
  inferredGenres: string[];
} {
  const trimmed = (rawQuery || '').trim();
  const simplified = toSimplifiedChinese(trimmed);
  const compact = compactNormalize(simplified);
  const py = toPinyinInfo(simplified);
  const expanded = new Set<string>();
  if (trimmed) expanded.add(trimmed);
  if (simplified && simplified !== trimmed) expanded.add(simplified);

  // Check exact pinyin query rewrite
  if (PINYIN_QUERY_REWRITES[compact]) {
    expanded.add(PINYIN_QUERY_REWRITES[compact]);
  }

  // Check artist alias match (either whole query or prefix/suffix token)
  let matchedArtist: string | undefined;
  const directArtist = ALIAS_TO_ENTRY.get(compact);
  if (directArtist) {
    matchedArtist = directArtist.canonical;
    expanded.add(directArtist.canonical);
  } else {
    const lowerSimp = simplified.toLowerCase();
    for (const entry of ARTIST_KNOWLEDGE_BASE) {
      for (const alias of entry.aliases) {
        const aliasLower = alias.toLowerCase();
        if (aliasLower.length >= 3 && lowerSimp.includes(aliasLower)) {
          matchedArtist = entry.canonical;
          const replaced = lowerSimp.replace(aliasLower, entry.canonical).trim();
          if (replaced) expanded.add(replaced);
          break;
        }
      }
      if (matchedArtist) break;
    }
    // Fuzzy check against known English artist names for typos (e.g., "tayler swift" -> "Taylor Swift", "coldpaly" -> "Coldplay")
    if (!matchedArtist && /^[a-z0-9\s.'-]+$/i.test(trimmed) && compact.length >= 5) {
      let bestDist = 3;
      let bestEntry: ArtistCatalogEntry | undefined;
      for (const entry of ARTIST_KNOWLEDGE_BASE) {
        for (const alias of [entry.canonical, ...entry.aliases]) {
          const aComp = compactNormalize(alias);
          if (!/^[a-z0-9]+$/.test(aComp) || Math.abs(aComp.length - compact.length) > 2) continue;
          const dist = damerauLevenshtein(compact, aComp, 2);
          if (dist > 0 && dist <= 2 && dist < bestDist) {
            bestDist = dist;
            bestEntry = entry;
          }
        }
      }
      if (bestEntry) {
        matchedArtist = bestEntry.canonical;
        expanded.add(bestEntry.canonical);
      }
    }
  }

  const { genres: inferredGenres } = extractQueryGenres(simplified);

  return {
    simplified,
    compact,
    pinyinFull: py.full,
    pinyinInitials: py.initials,
    expandedQueries: Array.from(expanded).slice(0, 4),
    matchedArtist,
    inferredGenres,
  };
}

// ── 5. Track Edition Classifier & Clean Base Title Extractor ──
export function classifyTrackEdition(title: string, album = ''): TrackEdition {
  const combined = toSimplifiedChinese(`${title || ''} ${album || ''}`).toLowerCase();
  if (/(伴奏|纯音乐|\binstrumental\b|\binst\.?\b|karaoke|卡拉ok|backing\s*track|off\s*vocal|无人声|消音版)/i.test(combined)) {
    return 'instrumental';
  }
  if (/(翻唱|\bcover\b|covered\s+by|女声版|男声版|烟嗓版|弹唱版)/i.test(combined)) {
    return 'cover';
  }
  if (/(\bremix\b|dj版|dj慢摇|慢摇|\bbootleg\b|\bmashup\b|混音版|0\.8x|1\.2x|sped\s*up|slowed)/i.test(combined)) {
    return 'remix';
  }
  if (/(\blive\b|现场|演唱会|\bconcert\b|音乐节|\bunplugged\b|不插电)/i.test(combined)) {
    return 'live';
  }
  if (/(\bacoustic\b|木吉他版|钢琴版)/i.test(combined)) {
    return 'acoustic';
  }
  if (/(\bdemo\b|小样)/i.test(combined)) {
    return 'demo';
  }
  return 'studio';
}

export function extractCleanBaseTitle(title: string): string {
  const simp = toSimplifiedChinese(title || '');
  const stripped = simp
    .replace(
      /\s*[\(\[\{（【《「][^\)\]\}）】》」]*(live|现场|演唱会|remaster|remastered|flac|320k|sq|hq|伴奏|instrumental|inst|cover|翻唱|remix|dj|acoustic|demo|原唱|无损|高品质|纯音乐|片段|铃声|电影|电视剧|主题曲|插曲|片尾曲|ost|国语|粤语)[^\)\]\}）】》」]*[\)\]\}）】》」]/gi,
      '',
    )
    .replace(/\s*[-—–]\s*(live|remastered\s*\d*|伴奏|纯音乐|翻唱版?|现场版?|remix).*$/i, '');
  return compactNormalize(stripped) || compactNormalize(simp);
}

// ── 6. Honest Metadata Language & Genre/Tag Inference ──
const CANTONESE_MARKERS = /(粤语|广东歌|富士山下|喜帖街|千千阙歌|海阔天空|光辉岁月|真的爱你|喜欢你|冷雨夜|浮夸|单车|明年今日|无条件|最佳损友|k歌之王)/i;

export function inferTrackLanguage(title: string, artist: string, album = '', edition?: TrackEdition): InferredLanguage {
  if (edition === 'instrumental') return 'inst';
  const text = `${title || ''} ${album || ''}`;
  if (/[\u3040-\u30ff]/.test(text)) return 'ja';
  if (/[\uac00-\ud7af]/.test(text)) return 'ko';

  const artistInfo = getArtistKnowledge(artist);
  if (artistInfo?.language && artistInfo.language !== 'unknown') {
    if (artistInfo.language === 'zh' && CANTONESE_MARKERS.test(toSimplifiedChinese(text))) {
      return 'yue';
    }
    return artistInfo.language;
  }

  if (CANTONESE_MARKERS.test(toSimplifiedChinese(text))) return 'yue';
  if (/[\u4e00-\u9fff]/.test(`${text} ${artist || ''}`)) return 'zh';
  if (/[a-zA-Z]{2,}/.test(text)) return 'en';
  return 'unknown';
}

export function extractGenresAndTags(params: {
  title: string;
  artist: string;
  album?: string;
  edition?: TrackEdition;
  language?: InferredLanguage;
  explicitGenres?: string[];
}): { genres: string[]; tags: string[] } {
  const genres = new Set<string>();
  const tags = new Set<string>();

  if (Array.isArray(params.explicitGenres)) {
    for (const g of params.explicitGenres) {
      if (g) genres.add(g.toLowerCase().trim());
    }
  }

  const artistInfo = getArtistKnowledge(params.artist);
  if (artistInfo) {
    for (const g of artistInfo.genres) genres.add(g);
  }

  const text = toSimplifiedChinese(`${params.title} ${params.album || ''}`).toLowerCase();
  const { genres: textGenres } = extractQueryGenres(text);
  for (const g of textGenres) genres.add(g);

  if (params.edition && params.edition !== 'studio') {
    tags.add(params.edition);
  }
  if (params.language === 'yue') {
    genres.add('cantopop');
    tags.add('粤语');
  } else if (params.language === 'zh' && genres.size === 0) {
    genres.add('mandopop');
  } else if (params.language === 'ja' && genres.size === 0) {
    genres.add('j-pop');
  } else if (params.language === 'ko' && genres.size === 0) {
    genres.add('k-pop');
  } else if (params.language === 'inst') {
    genres.add('instrumental');
  } else if (params.language === 'en' && genres.size === 0) {
    genres.add('pop');
  }

  if (/(ost|原声|主题曲|插曲|片尾曲|电影|电视剧)/i.test(text)) {
    tags.add('ost');
  }

  return {
    genres: Array.from(genres),
    tags: Array.from(tags),
  };
}

// ── 7. Bounded Damerau-Levenshtein & Fuzzy Token Similarity ──
export function damerauLevenshtein(a: string, b: string, maxDist = 4): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > maxDist) return maxDist + 1;
  if (la === 0) return lb;
  if (lb === 0) return la;

  const dp: number[][] = Array.from({ length: la + 1 }, () => new Array<number>(lb + 1).fill(0));
  for (let i = 0; i <= la; i++) dp[i][0] = i;
  for (let j = 0; j <= lb; j++) dp[0][j] = j;

  for (let i = 1; i <= la; i++) {
    let rowMin = maxDist + 1;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let val = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        val = Math.min(val, dp[i - 2][j - 2] + 1);
      }
      dp[i][j] = val;
      if (val < rowMin) rowMin = val;
    }
    if (rowMin > maxDist) return maxDist + 1;
  }
  return dp[la][lb];
}

export function computeFuzzySimilarity(queryNorm: string, targetNorm: string): number {
  if (!queryNorm || !targetNorm) return 0;
  if (queryNorm === targetNorm) return 1.0;
  if (targetNorm.startsWith(queryNorm)) {
    return 0.88 + 0.1 * (queryNorm.length / Math.max(1, targetNorm.length));
  }
  if (targetNorm.includes(queryNorm)) {
    return 0.72 + 0.15 * (queryNorm.length / Math.max(1, targetNorm.length));
  }

  const maxLen = Math.max(queryNorm.length, targetNorm.length);
  if (maxLen >= 3 && Math.abs(queryNorm.length - targetNorm.length) <= 3) {
    const dist = damerauLevenshtein(queryNorm, targetNorm, 3);
    if (dist <= 2) {
      return Math.max(0, 1 - dist / maxLen);
    }
  }

  // Character bigram Jaccard fallback for CJK & mixed strings
  if (queryNorm.length >= 2 && targetNorm.length >= 2) {
    const qGrams = new Set<string>();
    for (let i = 0; i < queryNorm.length - 1; i++) qGrams.add(queryNorm.slice(i, i + 2));
    let intersect = 0;
    const tGrams = new Set<string>();
    for (let i = 0; i < targetNorm.length - 1; i++) {
      const g = targetNorm.slice(i, i + 2);
      tGrams.add(g);
      if (qGrams.has(g)) intersect++;
    }
    const union = qGrams.size + tGrams.size - intersect;
    if (union > 0) return intersect / union;
  }

  return 0;
}

export function buildFtsTokens(text: string): string {
  const simp = toSimplifiedChinese(text || '').toLowerCase();
  const words = simp
    .replace(/[^\u4e00-\u9fffa-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const out = new Set<string>(words);
  for (const w of words) {
    if (/[\u4e00-\u9fff]/.test(w)) {
      const chars = Array.from(w);
      chars.forEach((c) => out.add(c));
      for (let i = 0; i < chars.length - 1; i++) {
        out.add(chars[i] + chars[i + 1]);
      }
    }
  }
  return Array.from(out).join(' ');
}
