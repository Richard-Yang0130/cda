/**
 * 穿搭风格 → 品牌映射。
 *
 * 用途：注册流程第 4 步选风格、第 5 步按风格推荐品牌。
 *
 * 来源与说明：
 *   风格分类参考淘宝/天猫与京东服饰趋势白皮书对户外、运动、潮流赛道的划分，
 *   以及 GQ 台湾的户外机能品牌盘点等公开报道。
 *   **品牌清单是「该风格的常见代表品牌」而非权威榜单** ——
 *   品牌定位会随时间变化，上线前建议按实际招商情况增删。
 *
 * 每个风格的品牌数均 ≥ 20，满足注册第 5 步「每种风格罗列 20+ 品牌」的要求。
 */

export interface FashionStyle {
  id: string
  name: string
  /** 一句话说明，注册页展示 */
  desc: string
  /** 风格卡片的主色（demo 用纯色代替图片） */
  hex: string
  /** 按知名度大致排序的品牌 id 列表（引用 BRANDS） */
  brandIds: string[]
}

export interface Brand {
  id: string
  /** 中文名（有的话），用于搜索 */
  name: string
  /** 英文/原名，用于搜索与展示 */
  nameEn: string
  hex: string
}

// ────────────────────────────────────────────────────────────
// 品牌库
// ────────────────────────────────────────────────────────────

export const BRANDS: Brand[] = [
  // 极简
  { id: 'b_cos', name: 'COS', nameEn: 'COS', hex: '#dcdcdc' },
  { id: 'b_uniqlo', name: '优衣库', nameEn: 'UNIQLO', hex: '#e8e8e8' },
  { id: 'b_muji', name: '无印良品', nameEn: 'MUJI', hex: '#e5e0d8' },
  { id: 'b_lemaire', name: '勒梅尔', nameEn: 'Lemaire', hex: '#ddd6cc' },
  { id: 'b_jilsander', name: 'Jil Sander', nameEn: 'Jil Sander', hex: '#e0e0e0' },
  { id: 'b_theory', name: 'Theory', nameEn: 'Theory', hex: '#d8d8d8' },
  { id: 'b_arket', name: 'Arket', nameEn: 'Arket', hex: '#e2e2e2' },
  { id: 'b_jnby', name: '江南布衣', nameEn: 'JNBY', hex: '#d5cfc7' },
  { id: 'b_exception', name: '例外', nameEn: 'EXCEPTION', hex: '#cfc8bf' },
  { id: 'b_zuczug', name: '素然', nameEn: 'ZUCZUG', hex: '#d9d3ca' },
  { id: 'b_therow', name: 'The Row', nameEn: 'The Row', hex: '#e6e6e6' },
  { id: 'b_toteme', name: 'Totême', nameEn: 'Toteme', hex: '#ded8d0' },
  { id: 'b_apc', name: 'A.P.C.', nameEn: 'A.P.C.', hex: '#d2d2d2' },
  { id: 'b_everlane', name: 'Everlane', nameEn: 'Everlane', hex: '#e4e4e4' },
  { id: 'b_vince', name: 'Vince', nameEn: 'Vince', hex: '#dcd8d4' },
  { id: 'b_joseph', name: 'JOSEPH', nameEn: 'JOSEPH', hex: '#d6d6d6' },
  { id: 'b_filippak', name: 'Filippa K', nameEn: 'Filippa K', hex: '#dadada' },
  { id: 'b_massimodutti', name: 'Massimo Dutti', nameEn: 'Massimo Dutti', hex: '#d0cbc4' },
  { id: 'b_initial', name: 'Initial', nameEn: 'Initial', hex: '#d4cec6' },
  { id: 'b_icicle', name: '之禾', nameEn: 'ICICLE', hex: '#d8d2c9' },
  { id: 'b_margaret', name: '玛丝菲尔', nameEn: 'Marisfrolg', hex: '#dcd6cd' },

  // 机能
  { id: 'b_acronym', name: 'Acronym', nameEn: 'ACRONYM', hex: '#2b2b2b' },
  { id: 'b_nikeacg', name: 'Nike ACG', nameEn: 'Nike ACG', hex: '#3a3a3a' },
  { id: 'b_arcteryx', name: '始祖鸟', nameEn: "Arc'teryx", hex: '#1f2a33' },
  { id: 'b_veilance', name: 'Veilance', nameEn: 'Veilance', hex: '#2e3238' },
  { id: 'b_stoneisland', name: '石头岛', nameEn: 'Stone Island', hex: '#33403a' },
  { id: 'b_cpcompany', name: 'C.P. Company', nameEn: 'C.P. Company', hex: '#3b3b3b' },
  { id: 'b_snowpeak', name: '雪峰', nameEn: 'Snow Peak', hex: '#3d4a42' },
  { id: 'b_nanamica', name: 'Nanamica', nameEn: 'Nanamica', hex: '#37424c' },
  { id: 'b_goldwin', name: 'Goldwin', nameEn: 'Goldwin', hex: '#2c3a44' },
  { id: 'b_descente', name: '迪桑特', nameEn: 'Descente', hex: '#26343f' },
  { id: 'b_tnf', name: '北面', nameEn: 'The North Face', hex: '#1e1e1e' },
  { id: 'b_peakperf', name: 'Peak Performance', nameEn: 'Peak Performance', hex: '#2f3a40' },
  { id: 'b_klattermusen', name: '攀山鼠', nameEn: 'Klättermusen', hex: '#3a4436' },
  { id: 'b_norrona', name: 'Norrøna', nameEn: 'Norrøna', hex: '#2d3b45' },
  { id: 'b_enfinleve', name: 'Enfin Levé', nameEn: 'Enfin Levé', hex: '#333333' },
  { id: 'b_riotdiv', name: 'Riot Division', nameEn: 'Riot Division', hex: '#303030' },
  { id: 'b_hamcus', name: 'Hamcus', nameEn: 'Hamcus', hex: '#3c3c38' },
  { id: 'b_nikelab', name: 'NikeLab', nameEn: 'NikeLab', hex: '#282828' },
  { id: 'b_11bbs', name: '11 by BBS', nameEn: '11 by BBS', hex: '#353535' },
  { id: 'b_tilak', name: 'Tilak', nameEn: 'Tilak', hex: '#37423b' },
  { id: 'b_mammut', name: '猛犸象', nameEn: 'Mammut', hex: '#3f3a34' },

  // 山系
  { id: 'b_patagonia', name: '巴塔哥尼亚', nameEn: 'Patagonia', hex: '#3f5d6b' },
  { id: 'b_montbell', name: 'Montbell', nameEn: 'Montbell', hex: '#2f4a5c' },
  { id: 'b_columbia', name: '哥伦比亚', nameEn: 'Columbia', hex: '#2c3e50' },
  { id: 'b_salomon', name: '萨洛蒙', nameEn: 'Salomon', hex: '#3a3a3a' },
  { id: 'b_hoka', name: 'HOKA', nameEn: 'HOKA', hex: '#4a4a4a' },
  { id: 'b_merrell', name: 'Merrell', nameEn: 'Merrell', hex: '#4d4438' },
  { id: 'b_keen', name: 'KEEN', nameEn: 'KEEN', hex: '#4a5a3c' },
  { id: 'b_danner', name: 'Danner', nameEn: 'Danner', hex: '#463c30' },
  { id: 'b_kavu', name: 'KAVU', nameEn: 'KAVU', hex: '#5a5140' },
  { id: 'b_gramicci', name: 'Gramicci', nameEn: 'Gramicci', hex: '#4a5240' },
  { id: 'b_andwander', name: 'And Wander', nameEn: 'And Wander', hex: '#3e4a44' },
  { id: 'b_wildthings', name: 'Wild Things', nameEn: 'Wild Things', hex: '#3d4a52' },
  { id: 'b_nanga', name: 'NANGA', nameEn: 'NANGA', hex: '#41504a' },
  { id: 'b_helly', name: 'Helly Hansen', nameEn: 'Helly Hansen', hex: '#2b3a4a' },
  { id: 'b_fjallraven', name: '北极狐', nameEn: 'Fjällräven', hex: '#4a3f30' },
  { id: 'b_haglofs', name: 'Haglöfs', nameEn: 'Haglöfs', hex: '#3a4438' },
  { id: 'b_osprey', name: 'Osprey', nameEn: 'Osprey', hex: '#3c4a3a' },
  { id: 'b_deuter', name: 'Deuter', nameEn: 'Deuter', hex: '#3a4650' },
  { id: 'b_chums', name: 'Chums', nameEn: 'Chums', hex: '#4e5a4a' },

  // 城市通勤
  { id: 'b_ur', name: 'UR', nameEn: 'URBAN REVIVO', hex: '#c9c4bd' },
  { id: 'b_zara', name: 'ZARA', nameEn: 'ZARA', hex: '#cfc9c2' },
  { id: 'b_suitsupply', name: 'Suitsupply', nameEn: 'Suitsupply', hex: '#2f3540' },
  { id: 'b_hackett', name: 'Hackett', nameEn: 'Hackett', hex: '#3a4048' },
  { id: 'b_brooks', name: 'Brooks Brothers', nameEn: 'Brooks Brothers', hex: '#38414c' },
  { id: 'b_tedbaker', name: 'Ted Baker', nameEn: 'Ted Baker', hex: '#3e3a44' },
  { id: 'b_sandro', name: 'Sandro', nameEn: 'Sandro', hex: '#c8c2ba' },
  { id: 'b_maje', name: 'Maje', nameEn: 'Maje', hex: '#cec6bd' },
  { id: 'b_claudie', name: 'Claudie Pierlot', nameEn: 'Claudie Pierlot', hex: '#cac3ba' },
  { id: 'b_gxg', name: 'GXG', nameEn: 'GXG', hex: '#3a3a3a' },
  { id: 'b_peacebird', name: '太平鸟', nameEn: 'PEACEBIRD', hex: '#c6c0b8' },
  { id: 'b_yageer', name: '雅戈尔', nameEn: 'YOUNGOR', hex: '#39414a' },
  { id: 'b_baoxiniao', name: '报喜鸟', nameEn: 'Saint Angelo', hex: '#363d46' },
  { id: 'b_lanbao', name: '蓝豹', nameEn: 'LAMPO', hex: '#3c434c' },
  { id: 'b_jiumuwang', name: '九牧王', nameEn: 'JOEONE', hex: '#3a4048' },
  { id: 'b_hla', name: '海澜之家', nameEn: 'HLA', hex: '#414751' },
  { id: 'b_semir', name: '森马', nameEn: 'Semir', hex: '#c9c3bb' },
  { id: 'b_ochirly', name: '欧时力', nameEn: 'OCHIRLY', hex: '#cdc6be' },
  { id: 'b_only', name: 'ONLY', nameEn: 'ONLY', hex: '#cbc5bd' },
  { id: 'b_veromoda', name: 'VERO MODA', nameEn: 'VERO MODA', hex: '#c7c1b9' },
  { id: 'b_lily', name: 'LILY', nameEn: 'LILY', hex: '#cac4bc' },

  // 嘻哈 / 街头
  { id: 'b_supreme', name: 'Supreme', nameEn: 'Supreme', hex: '#c0392b' },
  { id: 'b_stussy', name: 'Stüssy', nameEn: 'Stüssy', hex: '#2c2c2c' },
  { id: 'b_palace', name: 'Palace', nameEn: 'Palace', hex: '#2e2e2e' },
  { id: 'b_bape', name: 'BAPE', nameEn: 'A Bathing Ape', hex: '#2a2a2a' },
  { id: 'b_offwhite', name: 'Off-White', nameEn: 'Off-White', hex: '#1f1f1f' },
  { id: 'b_palmangels', name: 'Palm Angels', nameEn: 'Palm Angels', hex: '#282828' },
  { id: 'b_fog', name: 'Fear of God', nameEn: 'Fear of God', hex: '#262626' },
  { id: 'b_rhude', name: 'Rhude', nameEn: 'Rhude', hex: '#2b2b2b' },
  { id: 'b_kith', name: 'Kith', nameEn: 'Kith', hex: '#303030' },
  { id: 'b_noah', name: 'Noah', nameEn: 'Noah', hex: '#2f2f2f' },
  { id: 'b_carharttwip', name: 'Carhartt WIP', nameEn: 'Carhartt WIP', hex: '#4a4034' },
  { id: 'b_dickies', name: 'Dickies', nameEn: 'Dickies', hex: '#4c4438' },
  { id: 'b_champion', name: 'Champion', nameEn: 'Champion', hex: '#3a3a3a' },
  { id: 'b_kappa', name: 'Kappa', nameEn: 'Kappa', hex: '#2d2d2d' },
  { id: 'b_clot', name: 'CLOT', nameEn: 'CLOT', hex: '#333333' },
  { id: 'b_roaringwild', name: 'ROARINGWILD', nameEn: 'ROARINGWILD', hex: '#2a2a2a' },
  { id: 'b_randomevent', name: 'Randomevent', nameEn: 'Randomevent', hex: '#313131' },
  { id: 'b_umeplay', name: 'UMEPLAY', nameEn: 'UMEPLAY', hex: '#353535' },
  { id: 'b_npc', name: 'NPC', nameEn: 'NPC', hex: '#2e2e2e' },
  { id: 'b_myge', name: 'MYGE', nameEn: 'MYGE', hex: '#373737' },
  { id: 'b_clawmoney', name: 'Claw Money', nameEn: 'Claw Money', hex: '#3b3b3b' },

  // 运动
  { id: 'b_nike', name: '耐克', nameEn: 'Nike', hex: '#2b2b2b' },
  { id: 'b_adidas', name: '阿迪达斯', nameEn: 'Adidas', hex: '#333333' },
  { id: 'b_puma', name: '彪马', nameEn: 'PUMA', hex: '#303030' },
  { id: 'b_ua', name: '安德玛', nameEn: 'Under Armour', hex: '#262626' },
  { id: 'b_nb', name: '新百伦', nameEn: 'New Balance', hex: '#3a3a3a' },
  { id: 'b_asics', name: '亚瑟士', nameEn: 'ASICS', hex: '#2f2f2f' },
  { id: 'b_lining', name: '李宁', nameEn: 'LI-NING', hex: '#2c2c2c' },
  { id: 'b_anta', name: '安踏', nameEn: 'ANTA', hex: '#2e2e2e' },
  { id: 'b_xtep', name: '特步', nameEn: 'XTEP', hex: '#343434' },
  { id: 'b_361', name: '361°', nameEn: '361°', hex: '#383838' },
  { id: 'b_reebok', name: '锐步', nameEn: 'Reebok', hex: '#313131' },
  { id: 'b_skechers', name: '斯凯奇', nameEn: 'Skechers', hex: '#363636' },
  { id: 'b_lulu', name: 'lululemon', nameEn: 'lululemon', hex: '#c0405a' },
  { id: 'b_gymshark', name: 'Gymshark', nameEn: 'Gymshark', hex: '#2a2a2a' },
  { id: 'b_fila', name: 'FILA', nameEn: 'FILA', hex: '#3c3c3c' },
  { id: 'b_mizuno', name: '美津浓', nameEn: 'Mizuno', hex: '#2d3a4a' },
  { id: 'b_saucony', name: '索康尼', nameEn: 'Saucony', hex: '#343434' },
  { id: 'b_on', name: 'On', nameEn: 'On Running', hex: '#3a3a3a' },
  { id: 'b_brooksrun', name: 'Brooks', nameEn: 'Brooks Running', hex: '#2f3a44' },

  // 美式复古
  { id: 'b_redwing', name: '红翼', nameEn: 'Red Wing', hex: '#5a3d2b' },
  { id: 'b_levis', name: '李维斯', nameEn: "Levi's", hex: '#3a4a5c' },
  { id: 'b_lee', name: 'Lee', nameEn: 'Lee', hex: '#3c4a58' },
  { id: 'b_wrangler', name: 'Wrangler', nameEn: 'Wrangler', hex: '#3e4a56' },
  { id: 'b_carhartt', name: 'Carhartt', nameEn: 'Carhartt', hex: '#4a4034' },
  { id: 'b_rrl', name: 'RRL', nameEn: 'RRL', hex: '#4b4033' },
  { id: 'b_kapital', name: 'Kapital', nameEn: 'Kapital', hex: '#4a4438' },
  { id: 'b_visvim', name: 'Visvim', nameEn: 'Visvim', hex: '#463f36' },
  { id: 'b_mccoys', name: "The Real McCoy's", nameEn: "The Real McCoy's", hex: '#4d4237' },
  { id: 'b_buzz', name: "Buzz Rickson's", nameEn: "Buzz Rickson's", hex: '#494034' },
  { id: 'b_sugarcane', name: 'Sugar Cane', nameEn: 'Sugar Cane', hex: '#4f4538' },
  { id: 'b_studio', name: "Studio D'Artisan", nameEn: "Studio D'Artisan", hex: '#4b4237' },
  { id: 'b_edwin', name: 'Edwin', nameEn: 'Edwin', hex: '#44403a' },
  { id: 'b_evisu', name: 'Evisu', nameEn: 'Evisu', hex: '#474038' },
  { id: 'b_nudie', name: 'Nudie Jeans', nameEn: 'Nudie Jeans', hex: '#424b52' },
  { id: 'b_nakedfamous', name: 'Naked & Famous', nameEn: 'Naked & Famous', hex: '#454d54' },
  { id: 'b_filson', name: 'Filson', nameEn: 'Filson', hex: '#4c4436' },
  { id: 'b_barbour', name: 'Barbour', nameEn: 'Barbour', hex: '#3f4a3c' },
  { id: 'b_woolrich', name: 'Woolrich', nameEn: 'Woolrich', hex: '#4a3f36' },
  { id: 'b_pendleton', name: 'Pendleton', nameEn: 'Pendleton', hex: '#4e4438' },
  { id: 'b_lvc', name: "Levi's Vintage", nameEn: "Levi's Vintage Clothing", hex: '#3d4a58' },

  // 国潮
  { id: 'b_huili', name: '回力', nameEn: 'Warrior', hex: '#3a3a3a' },
  { id: 'b_fiyue', name: '飞跃', nameEn: 'FEIYUE', hex: '#404040' },
  { id: 'b_meihua', name: '梅花', nameEn: 'Meihua', hex: '#3c3c3c' },
  { id: 'b_bosideng', name: '波司登', nameEn: 'BOSIDENG', hex: '#3e3e3e' },
  { id: 'b_mishan', name: '密扇', nameEn: 'MUKZIN', hex: '#8a4a4a' },
  { id: 'b_gaiya', name: '盖娅传说', nameEn: 'GAIYA', hex: '#7a4a5a' },
  { id: 'b_shushutong', name: 'SHUSHU/TONG', nameEn: 'SHUSHU/TONG', hex: '#b08a9a' },
  { id: 'b_yanxue', name: 'yàn xuè', nameEn: 'YANXUE', hex: '#9a8a7a' },
  { id: 'b_uma', name: 'UMA WANG', nameEn: 'UMA WANG', hex: '#8a7a6a' },
]

export function findBrand(id: string): Brand | undefined {
  return BRANDS.find((b) => b.id === id)
}

/** 按名称检索品牌（中英文都匹配），供注册第 5 步的搜索用 */
export function searchBrands(keyword: string): Brand[] {
  const k = keyword.trim().toLowerCase()
  if (!k) return BRANDS
  return BRANDS.filter(
    (b) => b.name.toLowerCase().includes(k) || b.nameEn.toLowerCase().includes(k),
  )
}

// ────────────────────────────────────────────────────────────
// 风格
// ────────────────────────────────────────────────────────────

export const FASHION_STYLES: FashionStyle[] = [
  {
    id: 's_minimal', name: '极简', desc: '干净线条、克制配色，把注意力留给材质与剪裁',
    hex: '#e0dcd6',
    brandIds: ['b_cos', 'b_uniqlo', 'b_muji', 'b_lemaire', 'b_therow', 'b_jilsander', 'b_theory', 'b_arket', 'b_toteme', 'b_apc', 'b_everlane', 'b_vince', 'b_joseph', 'b_filippak', 'b_massimodutti', 'b_initial', 'b_icicle', 'b_exception', 'b_zuczug', 'b_margaret', 'b_jnby'],
  },
  {
    id: 's_tech', name: '机能', desc: '功能性面料、立体结构，为城市与户外之间设计',
    hex: '#3a424a',
    brandIds: ['b_acronym', 'b_nikeacg', 'b_arcteryx', 'b_veilance', 'b_stoneisland', 'b_cpcompany', 'b_snowpeak', 'b_nanamica', 'b_goldwin', 'b_descente', 'b_tnf', 'b_peakperf', 'b_klattermusen', 'b_norrona', 'b_enfinleve', 'b_riotdiv', 'b_hamcus', 'b_nikelab', 'b_11bbs', 'b_tilak', 'b_mammut'],
  },
  {
    id: 's_gorpcore', name: '山系', desc: '把户外装备穿进日常，实用与氛围兼备',
    hex: '#3f4a44',
    brandIds: ['b_patagonia', 'b_arcteryx', 'b_tnf', 'b_snowpeak', 'b_montbell', 'b_columbia', 'b_mammut', 'b_salomon', 'b_hoka', 'b_merrell', 'b_keen', 'b_danner', 'b_kavu', 'b_gramicci', 'b_andwander', 'b_wildthings', 'b_nanga', 'b_helly', 'b_fjallraven', 'b_haglofs', 'b_osprey', 'b_deuter', 'b_chums'],
  },
  {
    id: 's_city', name: '城市通勤', desc: '上班得体、下班不违和，兼顾正式与松弛',
    hex: '#c9c4bd',
    brandIds: ['b_uniqlo', 'b_cos', 'b_massimodutti', 'b_theory', 'b_ur', 'b_zara', 'b_suitsupply', 'b_hackett', 'b_brooks', 'b_tedbaker', 'b_sandro', 'b_maje', 'b_claudie', 'b_gxg', 'b_peacebird', 'b_yageer', 'b_baoxiniao', 'b_lanbao', 'b_jiumuwang', 'b_hla', 'b_semir', 'b_ochirly', 'b_only', 'b_veromoda', 'b_lily'],
  },
  {
    id: 's_street', name: '嘻哈街头', desc: '宽松廓形、醒目 Logo，来自球鞋与音乐文化',
    hex: '#2e2e2e',
    brandIds: ['b_supreme', 'b_stussy', 'b_palace', 'b_bape', 'b_offwhite', 'b_palmangels', 'b_fog', 'b_rhude', 'b_kith', 'b_noah', 'b_carharttwip', 'b_dickies', 'b_champion', 'b_kappa', 'b_clot', 'b_roaringwild', 'b_randomevent', 'b_umeplay', 'b_npc', 'b_myge', 'b_clawmoney'],
  },
  {
    id: 's_sport', name: '运动', desc: '为训练与跑步而生，性能优先',
    hex: '#333333',
    brandIds: ['b_nike', 'b_adidas', 'b_puma', 'b_ua', 'b_nb', 'b_asics', 'b_lining', 'b_anta', 'b_xtep', 'b_361', 'b_reebok', 'b_skechers', 'b_lulu', 'b_gymshark', 'b_fila', 'b_mizuno', 'b_saucony', 'b_on', 'b_brooksrun', 'b_descente', 'b_hoka'],
  },
  {
    id: 's_amekaji', name: '美式复古', desc: '丹宁、工装、皮靴，越旧越有味道',
    hex: '#4a4034',
    brandIds: ['b_redwing', 'b_levis', 'b_lee', 'b_wrangler', 'b_carhartt', 'b_rrl', 'b_kapital', 'b_visvim', 'b_mccoys', 'b_buzz', 'b_sugarcane', 'b_studio', 'b_edwin', 'b_evisu', 'b_nudie', 'b_nakedfamous', 'b_filson', 'b_barbour', 'b_woolrich', 'b_pendleton', 'b_lvc'],
  },
  {
    id: 's_guochao', name: '国潮', desc: '本土设计与中国元素，价格与表达都更贴近日常',
    hex: '#8a4a4a',
    brandIds: ['b_lining', 'b_anta', 'b_roaringwild', 'b_randomevent', 'b_umeplay', 'b_npc', 'b_myge', 'b_peacebird', 'b_semir', 'b_huili', 'b_fiyue', 'b_meihua', 'b_bosideng', 'b_jnby', 'b_exception', 'b_mishan', 'b_gaiya', 'b_shushutong', 'b_yanxue', 'b_uma', 'b_xtep'],
  },
]

export function findStyle(id: string): FashionStyle | undefined {
  return FASHION_STYLES.find((s) => s.id === id)
}

/**
 * 按已选风格推荐品牌（注册第 5 步）。
 * 多个风格时合并去重，并按「被多少个已选风格命中」排序 ——
 * 命中越多说明越跨风格，越该排前面。
 */
export function recommendBrands(styleIds: string[]): Brand[] {
  const hit = new Map<string, number>()
  for (const sid of styleIds) {
    const st = findStyle(sid)
    if (!st) continue
    for (const bid of st.brandIds) hit.set(bid, (hit.get(bid) ?? 0) + 1)
  }
  const list: Brand[] = []
  for (const [bid] of [...hit.entries()].sort((a, b) => b[1] - a[1])) {
    const b = findBrand(bid)
    if (b && !list.some((x) => x.id === b.id)) list.push(b)
  }
  return list
}

/** 注册第 5 步：最多可选品牌数 */
export const MAX_FAVORITE_BRANDS = 15
/** 个人主页最多展示的品牌数（按用户排序后的前 N 个） */
export const MAX_HOMEPAGE_BRANDS = 5
