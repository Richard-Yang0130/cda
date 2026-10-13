/**
 * 收货地址。
 *
 * 依据开源商城系统分析（docs/开源商城系统分析.md）：五个主流开源商城
 * **全都有**收货地址管理，且都是「省市区三级 + 默认地址」的标准形态。
 * 这是购物 App 的硬前提，我们此前完全没有。
 */

export interface Address {
  id: string
  /** 收货人 */
  name: string
  phone: string
  /** 省 / 市 / 区，三级分开存便于筛选与统计 */
  province: string
  city: string
  district: string
  /** 详细地址（街道门牌） */
  detail: string
  /** 是否默认地址；同一用户最多一个 */
  isDefault: boolean
  /** 标签：家 / 公司 / 学校 */
  tag?: string
}

/** 省市区数据（演示用；真实实现应接行政区划接口或本地全量表） */
export const REGION_DATA: Record<string, Record<string, string[]>> = {
  北京市: { 北京市: ['东城区', '西城区', '朝阳区', '海淀区', '丰台区', '通州区'] },
  上海市: { 上海市: ['黄浦区', '徐汇区', '长宁区', '静安区', '浦东新区', '闵行区'] },
  广东省: {
    广州市: ['天河区', '越秀区', '海珠区', '番禺区', '白云区'],
    深圳市: ['南山区', '福田区', '罗湖区', '宝安区', '龙岗区'],
    东莞市: ['南城街道', '东城街道', '莞城街道'],
  },
  浙江省: {
    杭州市: ['西湖区', '上城区', '滨江区', '余杭区', '拱墅区'],
    宁波市: ['海曙区', '江北区', '鄞州区'],
  },
  江苏省: {
    南京市: ['玄武区', '鼓楼区', '建邺区', '江宁区'],
    苏州市: ['姑苏区', '工业园区', '高新区', '吴中区'],
  },
  四川省: { 成都市: ['锦江区', '武侯区', '高新区', '成华区', '天府新区'] },
  湖北省: { 武汉市: ['武昌区', '洪山区', '江汉区', '东湖高新区'] },
}

export const PROVINCES = Object.keys(REGION_DATA)

export function citiesOf(province: string): string[] {
  return Object.keys(REGION_DATA[province] ?? {})
}

export function districtsOf(province: string, city: string): string[] {
  return REGION_DATA[province]?.[city] ?? []
}

const PHONE_RE = /^1[3-9]\d{9}$/

export interface AddressCheck {
  ok: boolean
  reason?: string
}

/** 收货地址校验 —— 集中一处，避免各端各写一套 */
export function validateAddress(a: Omit<Address, 'id' | 'isDefault'>): AddressCheck {
  if (!a.name.trim()) return { ok: false, reason: '请填写收货人姓名' }
  if (a.name.trim().length > 20) return { ok: false, reason: '收货人姓名过长' }
  if (!PHONE_RE.test(a.phone)) return { ok: false, reason: '手机号格式不正确' }
  if (!a.province || !a.city || !a.district) return { ok: false, reason: '请选择完整的省市区' }
  if (a.detail.trim().length < 4) return { ok: false, reason: '详细地址太短，请填写到门牌号' }
  return { ok: true }
}

/** 展示用的一行地址 */
export function formatAddress(a: Address): string {
  return `${a.province}${a.city}${a.district} ${a.detail}`
}
