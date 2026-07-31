import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Channel } from '../types';
import { useWarehouseStore } from './warehouse';

const clampPriority = (n: number | undefined) => {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 1) return 10;
  return Math.min(20, Math.round(v));
};

function newChannelId() {
  return `CH_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

/** 解析渠道关联的全部主体（兼容旧数据仅有 companyId） */
export function getChannelCompanyIds(ch: Pick<Channel, 'companyId' | 'companyIds' | 'warehouseIds'>): string[] {
  const whStore = useWarehouseStore();
  const fromField = Array.isArray(ch.companyIds)
    ? ch.companyIds.map(String).filter(Boolean)
    : [];
  const fromWh: string[] = [];
  for (const wid of ch.warehouseIds || []) {
    const w = whStore.getWarehouseById(wid);
    if (w?.companyId) fromWh.push(w.companyId);
  }
  const legacy = ch.companyId ? [String(ch.companyId)] : [];
  return [...new Set([...fromField, ...fromWh, ...legacy])];
}

export function channelBelongsToCompany(
  ch: Pick<Channel, 'companyId' | 'companyIds' | 'warehouseIds'>,
  companyId: string,
): boolean {
  if (!companyId) return false;
  return getChannelCompanyIds(ch).includes(companyId);
}

/** 根据仓库列表推导 companyIds / companyId */
export function deriveChannelCompanies(warehouseIds: string[], preferredIds: string[] = []) {
  const whStore = useWarehouseStore();
  const fromWh: string[] = [];
  const validWh: string[] = [];
  const seen = new Set<string>();
  for (const wid of warehouseIds || []) {
    const w = whStore.getWarehouseById(wid);
    if (!w || seen.has(w.id)) continue;
    seen.add(w.id);
    validWh.push(w.id);
    fromWh.push(w.companyId);
  }
  const companyIds = [...new Set([...preferredIds.filter(Boolean), ...fromWh])];
  return {
    warehouseIds: validWh,
    companyIds,
    companyId: companyIds[0] || '',
  };
}

export const useChannelStore = defineStore('channel', () => {
  const channels = ref<Channel[]>([]);

  const nextChannelCode = () => {
    let max = 0;
    for (const ch of channels.value) {
      const m = String(ch.code || '').match(/^CH(\d+)$/i);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return `CH${String(max + 1).padStart(3, '0')}`;
  };

  const normalizeChannel = (ch: Channel, index: number): Channel => {
    const code =
      (ch.code && String(ch.code).trim()) ||
      (ch.id && /^C\d+$/i.test(ch.id) ? ch.id.replace(/^C/i, 'CH') : '') ||
      `CH${String(index + 1).padStart(3, '0')}`;
    const derived = deriveChannelCompanies(
      Array.isArray(ch.warehouseIds) ? ch.warehouseIds : [],
      getChannelCompanyIds(ch),
    );
    return {
      ...ch,
      code,
      priority: clampPriority(ch.priority),
      enabled: ch.enabled !== false,
      warehouseIds: derived.warehouseIds,
      companyIds: derived.companyIds.length
        ? derived.companyIds
        : ch.companyId
          ? [ch.companyId]
          : [],
      companyId: derived.companyId || ch.companyId || '',
    };
  };

  const initChannels = () => {
    if (channels.value.length > 0) {
      const whStore = useWarehouseStore();
      const seenCodes = new Set<string>();
      channels.value = channels.value.map((raw, i) => {
        const ch = normalizeChannel(raw as Channel, i);
        let code = ch.code;
        if (seenCodes.has(code.toUpperCase())) {
          code = nextChannelCode();
        }
        seenCodes.add(code.toUpperCase());

        // 修复仓库引用：允许跨主体；按 id / 编码 / 名称匹配
        const repaired: string[] = [];
        const seenWh = new Set<string>();
        for (const ref of ch.warehouseIds) {
          const key = String(ref || '').trim();
          if (!key) continue;
          let w = whStore.getWarehouseById(key);
          if (!w) {
            w = whStore.warehouses.find(x => x.code === key || x.name === key || x.id === key);
          }
          if (!w || seenWh.has(w.id)) continue;
          seenWh.add(w.id);
          repaired.push(w.id);
        }
        const preferred = getChannelCompanyIds({ ...ch, warehouseIds: repaired });
        const derived = deriveChannelCompanies(repaired, preferred);
        return {
          ...ch,
          code,
          warehouseIds: derived.warehouseIds,
          // 仓全失效时仍保留原主体关联，否则要货下拉会出现「选了主体却没有渠道」
          companyIds: derived.companyIds.length ? derived.companyIds : preferred,
          companyId: derived.companyId || preferred[0] || ch.companyId || '',
        };
      });
      return;
    }
    channels.value = [
      { id: 'C001', code: 'CH001', name: 'A渠道', warehouseIds: ['W001', 'W002', 'W003'], priority: 1, companyId: 'COMP001', companyIds: ['COMP001'], enabled: true },
      { id: 'C002', code: 'CH002', name: 'B渠道', warehouseIds: ['W001', 'W004'], priority: 2, companyId: 'COMP001', companyIds: ['COMP001'], enabled: true },
      { id: 'C003', code: 'CH003', name: 'C渠道', warehouseIds: ['W005'], priority: 1, companyId: 'COMP002', companyIds: ['COMP002'], enabled: true },
      { id: 'C004', code: 'CH004', name: 'D渠道', warehouseIds: ['W005'], priority: 10, companyId: 'COMP002', companyIds: ['COMP002'], enabled: true },
      { id: 'C005', code: 'CH005', name: 'E渠道', warehouseIds: ['W006', 'W007'], priority: 1, companyId: 'COMP003', companyIds: ['COMP003'], enabled: true },
      { id: 'C006', code: 'CH006', name: 'F渠道', warehouseIds: ['W008'], priority: 2, companyId: 'COMP004', companyIds: ['COMP004'], enabled: true },
    ];
  };

  const addChannel = (channel: Omit<Channel, 'id'>) => {
    const derived = deriveChannelCompanies(channel.warehouseIds, [
      ...getChannelCompanyIds(channel),
      ...(Array.isArray(channel.companyIds) ? channel.companyIds : []),
    ]);
    if (!derived.warehouseIds.length) {
      throw new Error('请至少关联一个有效仓库');
    }
    if (!derived.companyIds.length) {
      throw new Error('无法确定关联主体，请重新勾选仓库');
    }
    const code = (channel.code && String(channel.code).trim()) || nextChannelCode();
    if (channels.value.some(c => c.code.toUpperCase() === code.toUpperCase())) {
      throw new Error(`渠道编码已存在：${code}`);
    }
    channels.value.push({
      ...channel,
      warehouseIds: derived.warehouseIds,
      companyIds: derived.companyIds,
      companyId: derived.companyId,
      code,
      id: newChannelId(),
      priority: clampPriority(channel.priority),
      enabled: channel.enabled !== false,
    });
  };

  const updateChannel = (id: string, channel: Partial<Channel>) => {
    const index = channels.value.findIndex(c => c.id === id);
    if (index === -1) return;
    const next = { ...channels.value[index], ...channel };
    if (channel.code != null) {
      const code = String(channel.code).trim();
      if (!code) throw new Error('渠道编码不能为空');
      if (channels.value.some(c => c.id !== id && c.code.toUpperCase() === code.toUpperCase())) {
        throw new Error(`渠道编码已存在：${code}`);
      }
      next.code = code;
    }
    if (channel.priority != null) next.priority = clampPriority(channel.priority);
    if (channel.enabled != null) next.enabled = !!channel.enabled;
    const derived = deriveChannelCompanies(next.warehouseIds || [], [
      ...getChannelCompanyIds(next),
      ...(Array.isArray(channel.companyIds) ? channel.companyIds : []),
    ]);
    next.warehouseIds = derived.warehouseIds;
    next.companyIds = derived.companyIds;
    next.companyId = derived.companyId;
    channels.value = channels.value.map((c, i) => (i === index ? next : c));
  };

  const deleteChannel = (id: string) => {
    const index = channels.value.findIndex(c => c.id === id);
    if (index !== -1) channels.value.splice(index, 1);
  };

  const getChannelById = (id: string) => channels.value.find(c => c.id === id);

  const getChannelByCode = (code: string) =>
    channels.value.find(c => c.code.toUpperCase() === String(code || '').trim().toUpperCase());

  const getChannelByName = (name: string, companyId?: string) => {
    const key = String(name || '').trim().toLowerCase();
    if (!key) return undefined;
    return channels.value.find(
      c =>
        String(c.name || '').trim().toLowerCase() === key
        && (!companyId || channelBelongsToCompany(c, companyId)),
    );
  };

  /** 编码或名称填一个即可（两列任意一列有值都可匹配编码或名称） */
  const resolveChannel = (codeOrName?: string, fallbackName?: string, companyId?: string) => {
    for (const raw of [codeOrName, fallbackName]) {
      const t = String(raw || '').trim();
      if (!t) continue;
      const byCode = getChannelByCode(t);
      if (byCode && byCode.enabled !== false) return byCode;
      if (companyId) {
        const byName = getChannelByName(t, companyId);
        if (byName && byName.enabled !== false) return byName;
      }
      const any = getChannelByName(t);
      if (any && any.enabled !== false) return any;
    }
    return undefined;
  };

  const getChannelsByCompany = (companyId: string, opts?: { includeDisabled?: boolean }) =>
    channels.value.filter(
      c => channelBelongsToCompany(c, companyId) && (opts?.includeDisabled || c.enabled !== false),
    );

  const getChannelsSortedByPriority = (companyId?: string, opts?: { includeDisabled?: boolean }) => {
    const list = companyId
      ? getChannelsByCompany(companyId, opts)
      : channels.value.filter(c => opts?.includeDisabled || c.enabled !== false);
    return [...list].sort((a, b) => a.priority - b.priority || a.code.localeCompare(b.code));
  };

  /** 在指定主体语境下、已启用、优先级更高（数字更小）的渠道 */
  const getHigherPriorityChannels = (channelId: string, companyId?: string) => {
    const current = getChannelById(channelId);
    if (!current) return [];
    const scopeCompany = companyId || current.companyId;
    return channels.value.filter(
      c =>
        c.id !== channelId &&
        c.enabled !== false &&
        channelBelongsToCompany(c, scopeCompany) &&
        c.priority < current.priority,
    );
  };

  const upsertChannel = (
    data: Omit<Channel, 'id' | 'code'> & { id?: string; code?: string },
  ) => {
    const byCode = data.code ? getChannelByCode(data.code) : undefined;
    const existing = byCode || getChannelByName(data.name, data.companyId);
    if (existing) {
      updateChannel(existing.id, data);
      return existing.id;
    }
    addChannel({
      ...data,
      code: data.code || nextChannelCode(),
    });
    return channels.value[channels.value.length - 1]?.id;
  };

  /** 把渠道上的旧主体 id 映射到去重后的标准 id */
  const remapCompanyIds = (idMap: Record<string, string>) => {
    let n = 0;
    channels.value = channels.value.map(ch => {
      const mapOne = (id: string) => idMap[id] || id;
      const companyIds = getChannelCompanyIds(ch).map(mapOne);
      const unique = [...new Set(companyIds.filter(Boolean))];
      const companyId = mapOne(ch.companyId || '') || unique[0] || '';
      const changed =
        companyId !== ch.companyId ||
        JSON.stringify(unique) !== JSON.stringify(ch.companyIds || []);
      if (!changed) return ch;
      n += 1;
      return { ...ch, companyId, companyIds: unique };
    });
    return n;
  };

  /** 仓库 id 去重后同步渠道绑定 */
  const remapWarehouseIds = (idMap: Record<string, string>) => {
    let n = 0;
    channels.value = channels.value.map(ch => {
      const nextWh = (ch.warehouseIds || []).map(id => idMap[id] || id);
      const same =
        nextWh.length === (ch.warehouseIds || []).length
        && nextWh.every((id, i) => id === ch.warehouseIds[i]);
      if (same) return ch;
      n += 1;
      const preferred = getChannelCompanyIds({ ...ch, warehouseIds: nextWh });
      const derived = deriveChannelCompanies(nextWh, preferred);
      return {
        ...ch,
        warehouseIds: derived.warehouseIds,
        companyIds: derived.companyIds.length ? derived.companyIds : preferred,
        companyId: derived.companyId || preferred[0] || ch.companyId || '',
      };
    });
    return n;
  };

  return {
    channels,
    initChannels,
    addChannel,
    updateChannel,
    deleteChannel,
    getChannelById,
    getChannelByCode,
    getChannelByName,
    resolveChannel,
    getChannelsByCompany,
    getChannelsSortedByPriority,
    getHigherPriorityChannels,
    upsertChannel,
    nextChannelCode,
    remapCompanyIds,
    remapWarehouseIds,
  };
}, { persist: true });
