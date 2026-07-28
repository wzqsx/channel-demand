import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Channel } from '../types';
import { useWarehouseStore } from './warehouse';

const clampPriority = (n: number | undefined) => {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 1) return 10;
  return Math.min(20, Math.round(v));
};

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
    return {
      ...ch,
      code,
      priority: clampPriority(ch.priority),
      enabled: ch.enabled !== false,
      warehouseIds: Array.isArray(ch.warehouseIds) ? ch.warehouseIds : [],
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
        const valid = ch.warehouseIds.filter(id => {
          const w = whStore.getWarehouseById(id);
          return w && w.companyId === ch.companyId;
        });
        return {
          ...ch,
          code,
          warehouseIds: valid.length ? valid : ch.warehouseIds,
        };
      });
      return;
    }
    channels.value = [
      { id: 'C001', code: 'CH001', name: 'A渠道', warehouseIds: ['W001', 'W002', 'W003'], priority: 1, companyId: 'COMP001', enabled: true },
      { id: 'C002', code: 'CH002', name: 'B渠道', warehouseIds: ['W001', 'W004'], priority: 2, companyId: 'COMP001', enabled: true },
      { id: 'C003', code: 'CH003', name: 'C渠道', warehouseIds: ['W005'], priority: 1, companyId: 'COMP002', enabled: true },
      { id: 'C004', code: 'CH004', name: 'D渠道', warehouseIds: ['W005'], priority: 10, companyId: 'COMP002', enabled: true },
      { id: 'C005', code: 'CH005', name: 'E渠道', warehouseIds: ['W006', 'W007'], priority: 1, companyId: 'COMP003', enabled: true },
      { id: 'C006', code: 'CH006', name: 'F渠道', warehouseIds: ['W008'], priority: 2, companyId: 'COMP004', enabled: true },
    ];
  };

  const addChannel = (channel: Omit<Channel, 'id'>) => {
    const whStore = useWarehouseStore();
    const warehouseIds = channel.warehouseIds.filter(id => {
      const w = whStore.getWarehouseById(id);
      return !!w && w.companyId === channel.companyId;
    });
    const code = (channel.code && String(channel.code).trim()) || nextChannelCode();
    if (channels.value.some(c => c.code.toUpperCase() === code.toUpperCase())) {
      throw new Error(`渠道编码已存在：${code}`);
    }
    channels.value.push({
      ...channel,
      warehouseIds,
      code,
      id: Date.now().toString(),
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
    const whStore = useWarehouseStore();
    next.warehouseIds = (next.warehouseIds || []).filter(wid => {
      const w = whStore.getWarehouseById(wid);
      return !!w && w.companyId === next.companyId;
    });
    channels.value[index] = next;
  };

  const deleteChannel = (id: string) => {
    const index = channels.value.findIndex(c => c.id === id);
    if (index !== -1) channels.value.splice(index, 1);
  };

  const getChannelById = (id: string) => channels.value.find(c => c.id === id);

  const getChannelByCode = (code: string) =>
    channels.value.find(c => c.code.toUpperCase() === String(code).trim().toUpperCase());

  const getChannelByName = (name: string, companyId?: string) =>
    channels.value.find(c => c.name === name && (!companyId || c.companyId === companyId));

  const getChannelsByCompany = (companyId: string, opts?: { includeDisabled?: boolean }) =>
    channels.value.filter(
      c => c.companyId === companyId && (opts?.includeDisabled || c.enabled !== false),
    );

  const getChannelsSortedByPriority = (companyId?: string, opts?: { includeDisabled?: boolean }) => {
    const list = companyId
      ? getChannelsByCompany(companyId, opts)
      : channels.value.filter(c => opts?.includeDisabled || c.enabled !== false);
    return [...list].sort((a, b) => a.priority - b.priority || a.code.localeCompare(b.code));
  };

  /** 仅同主体内、已启用、优先级更高（数字更小）的渠道 */
  const getHigherPriorityChannels = (channelId: string) => {
    const current = getChannelById(channelId);
    if (!current) return [];
    return channels.value.filter(
      c =>
        c.id !== channelId &&
        c.enabled !== false &&
        c.companyId === current.companyId &&
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

  return {
    channels,
    initChannels,
    addChannel,
    updateChannel,
    deleteChannel,
    getChannelById,
    getChannelByCode,
    getChannelByName,
    getChannelsByCompany,
    getChannelsSortedByPriority,
    getHigherPriorityChannels,
    upsertChannel,
    nextChannelCode,
  };
}, { persist: true });
