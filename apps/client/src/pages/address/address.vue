<template>
  <view class="page">
    <scroll-view class="body" scroll-y>
      <view v-for="a in store.addresses" :key="a.id" class="card">
        <view class="top">
          <text class="aname">{{ a.name }}</text>
          <text class="aphone">{{ a.phone }}</text>
          <text v-if="a.tag" class="atag">{{ a.tag }}</text>
          <text v-if="a.isDefault" class="adef">默认</text>
        </view>
        <text class="adetail">{{ formatAddress(a) }}</text>
        <view class="acts">
          <text class="act" @click="edit(a)">编辑</text>
          <text class="act" @click="setDefaultAddress(a.id)">设为默认</text>
          <text class="act del" @click="del(a.id)">删除</text>
        </view>
      </view>

      <view v-if="!store.addresses.length" class="none"><text>还没有收货地址</text></view>

      <view class="add" @click="add"><text>＋ 新增收货地址</text></view>
    </scroll-view>

    <view v-if="open" class="mask" @click="open = false">
      <view class="sheet" @click.stop>
        <text class="stitle">{{ form.id ? '编辑地址' : '新增地址' }}</text>

        <view class="frow"><text class="flab">收货人</text>
          <input v-model="form.name" class="finput" placeholder="姓名" placeholder-class="ph" :maxlength="20" />
        </view>
        <view class="frow"><text class="flab">手机号</text>
          <input v-model="form.phone" class="finput" type="number" :maxlength="11" placeholder="11 位手机号" placeholder-class="ph" />
        </view>
        <view class="frow">
          <text class="flab">地区</text>
          <picker class="finput" mode="multiSelector" :range="regionRange" :value="regionIdx" @change="onRegion" @columnchange="onRegionCol">
            <view class="pkbox"><text>{{ form.province ? form.province + ' ' + form.city + ' ' + form.district : '请选择省市区' }}</text></view>
          </picker>
        </view>
        <view class="frow"><text class="flab">详细地址</text>
          <input v-model="form.detail" class="finput" placeholder="街道、门牌号" placeholder-class="ph" />
        </view>
        <view class="frow">
          <text class="flab">标签</text>
          <view class="tags">
            <text v-for="t in tagList" :key="t" class="tg" :class="{ on: form.tag === t }" @click="form.tag = form.tag === t ? '' : t">{{ t }}</text>
          </view>
        </view>
        <view class="frow">
          <text class="flab">默认地址</text>
          <switch :checked="form.isDefault" color="#1a1a1a" @change="(e: any) => (form.isDefault = e.detail.value)" />
        </view>

        <text v-if="err" class="err">{{ err }}</text>

        <view class="fbtns">
          <view class="fbtn ghost" @click="open = false"><text>取消</text></view>
          <view class="fbtn" @click="save"><text>保存</text></view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import {
  PROVINCES, citiesOf, districtsOf, formatAddress, validateAddress, type Address,
} from '@cda/core'
import { store, upsertAddress, removeAddress, setDefaultAddress } from '@/store/app-store'

/**
 * 收货地址管理（分析得出的 P0）。
 * 五个主流开源商城全都有，且都是「省市区三级 + 默认地址」的标准形态；
 * 校验集中在 @cda/core/address.ts 的 validateAddress。
 */
const open = ref(false)
const err = ref('')
const tagList = ['家', '公司', '学校']

const blank = (): Address => ({
  id: '', name: '', phone: '',
  province: '', city: '', district: '', detail: '',
  isDefault: store.addresses.length === 0, tag: '',
})
const form = reactive<Address>(blank())
const regionIdx = ref([0, 0, 0])

const regionRange = computed(() => {
  const p = PROVINCES
  const prov = form.province || p[0]!
  const c = citiesOf(prov)
  const city = form.city || c[0] || ''
  const d = districtsOf(prov, city)
  return [p, c.length ? c : ['—'], d.length ? d : ['—']]
})

function onRegionCol(e: { detail: { column: number; value: number } }): void {
  const { column, value } = e.detail
  if (column === 0) {
    form.province = PROVINCES[value] ?? ''
    form.city = citiesOf(form.province)[0] ?? ''
    form.district = districtsOf(form.province, form.city)[0] ?? ''
    regionIdx.value = [value, 0, 0]
  } else if (column === 1) {
    form.city = citiesOf(form.province)[value] ?? ''
    form.district = districtsOf(form.province, form.city)[0] ?? ''
    regionIdx.value = [regionIdx.value[0]!, value, 0]
  } else {
    form.district = districtsOf(form.province, form.city)[value] ?? ''
    regionIdx.value = [regionIdx.value[0]!, regionIdx.value[1]!, value]
  }
}

function onRegion(e: { detail: { value: number[] } }): void {
  const [pi, ci, di] = e.detail.value
  const prov = PROVINCES[pi ?? 0] ?? ''
  const city = citiesOf(prov)[ci ?? 0] ?? ''
  form.province = prov
  form.city = city
  form.district = districtsOf(prov, city)[di ?? 0] ?? ''
  regionIdx.value = [pi ?? 0, ci ?? 0, di ?? 0]
}

function add(): void {
  Object.assign(form, blank())
  err.value = ''
  open.value = true
}

function edit(a: Address): void {
  Object.assign(form, a)
  err.value = ''
  open.value = true
}

function save(): void {
  const check = validateAddress(form)
  if (!check.ok) {
    err.value = check.reason ?? '请检查填写内容'
    return
  }
  upsertAddress({ ...form, id: form.id || `addr_${Date.now().toString(36)}` })
  open.value = false
  uni.showToast({ title: '已保存', icon: 'none' })
}

function del(id: string): void {
  uni.showModal({
    title: '删除该地址？',
    success: (r) => {
      if (r.confirm) removeAddress(id)
    },
  })
}
</script>

<style scoped>
.page { min-height: 100vh; background: #fbfbfb; }
.body { height: 100vh; padding: 14px 16px 40px; box-sizing: border-box; }
.card { background: #fff; border-radius: 13px; padding: 14px; margin-bottom: 10px; box-shadow: 0 1px 8px rgba(0,0,0,.04); }
.top { display: flex; align-items: center; gap: 9px; }
.aname { font-size: 15px; font-weight: 600; }
.aphone { font-size: 13px; color: #555; letter-spacing: .5px; }
.atag { font-size: 10px; color: #6a6a6a; background: #f2f2f2; padding: 2px 7px; border-radius: 6px; }
.adef { font-size: 10px; color: #fff; background: #1a1a1a; padding: 2px 7px; border-radius: 6px; }
.adetail { display: block; font-size: 12.5px; color: #777; line-height: 19px; margin-top: 7px; }
.acts { display: flex; gap: 16px; margin-top: 11px; padding-top: 10px; border-top: 1px solid #f4f4f4; }
.act { font-size: 12px; color: #4a7fa5; }
.act.del { color: #c0504d; }
.none { padding: 60px 0; text-align: center; color: #b8b8b8; font-size: 12.5px; }
.add { margin-top: 8px; height: 46px; border-radius: 12px; border: 1px dashed #cfcfcf; display: flex; align-items: center; justify-content: center; }
.add text { font-size: 13.5px; color: #666; }
.mask { position: fixed; left: 0; right: 0; top: 0; bottom: 0; background: rgba(0,0,0,.35); display: flex; align-items: flex-end; z-index: 50; }
.sheet { width: 100%; background: #fff; border-radius: 18px 18px 0 0; padding: 18px 16px 26px; box-sizing: border-box; max-height: 86vh; overflow-y: auto; }
.stitle { font-size: 16px; font-weight: 700; display: block; margin-bottom: 14px; }
.frow { display: flex; align-items: center; gap: 12px; padding: 11px 0; border-bottom: 1px solid #f4f4f4; }
.flab { width: 62px; font-size: 13px; color: #666; flex-shrink: 0; }
.finput { flex: 1; font-size: 14px; height: 32px; }
.pkbox { height: 32px; display: flex; align-items: center; }
.pkbox text { font-size: 14px; color: #222; }
.ph { color: #b8b8b8; }
.tags { display: flex; gap: 8px; }
.tg { font-size: 12px; color: #666; padding: 4px 12px; border-radius: 999px; background: #f2f2f2; }
.tg.on { background: #1a1a1a; color: #fff; }
.err { display: block; font-size: 11.5px; color: #c0504d; margin-top: 10px; }
.fbtns { display: flex; gap: 10px; margin-top: 18px; }
.fbtn { flex: 1; height: 44px; border-radius: 12px; background: #1a1a1a; display: flex; align-items: center; justify-content: center; }
.fbtn.ghost { background: #f2f2f2; flex: 0 0 96px; }
.fbtn.ghost text { color: #555; }
.fbtn text { color: #fff; font-size: 14px; font-weight: 600; }
</style>
