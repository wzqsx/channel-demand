import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Channel } from '../types';
import { useWarehouseStore } from './warehouse';

export const useChannelStore = defineStore('channel', () => {
  const channels = ref<Channel[]>([]);

  const initChannels = () => {
    if (channels.value.length > 0) {
      // 修复历史种子里跨主体挂仓
      channels.value.forEach(ch => {
        const whStore = useWarehouseStore();
        const valid = ch.warehouseIds.filter(id => {
          const w = whStore.getWarehouseById(id);
          return w && w.companyId === ch.companyId;
        });
        if (valid.length !== ch.warehouseIds.length) {
          ch.warehouseIds = valid.length ? valid : ch.warehouseIds;
        }
      });
      return;
    }
    channels.value = [
      { id: 'C001', name: 'A渠道', warehouseIds: ['W001', 'W002', 'W003'], priority: 1, companyId: 'COMP001' },
      { id: 'C002', name: 'B渠道', warehouseIds: ['W001', 'W004'], priority: 2, companyId: 'COMP001' },
      { id: 'C003', name: 'C渠道', warehouseIds: ['W005'], priority: 1, companyId: 'COMP002' },
      { id: 'C004', name: 'D渠道', warehouseIds: ['W005'], priority: 10, companyId: 'COMP002' },
      { id: 'C005', name: 'E渠道', warehouseIds: ['W006', 'W007'], priority: 1, companyId: 'COMP003' },
      { id: 'C006', name: 'F渠道', warehouseIds: ['W008'], priority: 2, companyId: 'COMP004' },
    ];
  };

  const addChannel = (channel: Omit<Channel, 'id'>) => {
    const whStore = useWarehouseStore();
    const warehouseIds = channel.warehouseIds.filter(id => {
      const w = whStore.getWarehouseById(id);
      return !!w && w.companyId === channel.companyId;
    });
    channels.value.push({
      ...channel,
      warehouseIds,
      id: Date.now().toString(),
      priority: channel.priority || 100,
    });
  };

  const updateChannel = (id: string, channel: Partial<Channel>) => {
    const index = channels.value.findIndex(c => c.id === id);
    if (index === -1) return;
    const next = { ...channels.value[index], ...channel };
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

  const getChannelByName = (name: string, companyId?: string) =>
    channels.value.find(c => c.name === name && (!companyId || c.companyId === companyId));

  const getChannelsByCompany = (companyId: string) =>
    channels.value.filter(c => c.companyId === companyId);

  const getChannelsSortedByPriority = (companyId?: string) => {
    const list = companyId ? getChannelsByCompany(companyId) : [...channels.value];
    return list.sort((a, b) => a.priority - b.priority);
  };

  /** 仅同主体内、优先级更高（数字更小）的渠道 */
  const getHigherPriorityChannels = (channelId: string) => {
    const current = getChannelById(channelId);
    if (!current) return [];
    return channels.value.filter(
      c =>
        c.id !== channelId &&
        c.companyId === current.companyId &&
        c.priority < current.priority,
    );
  };

  const upsertChannel = (data: Omit<Channel, 'id'>) => {
    const existing = getChannelByName(data.name, data.companyId);
    if (existing) {
      updateChannel(existing.id, data);
      return existing.id;
    }
    addChannel(data);
    return channels.value[channels.value.length - 1]?.id;
  };

  return {
    channels,
    initChannels,
    addChannel,
    updateChannel,
    deleteChannel,
    getChannelById,
    getChannelByName,
    getChannelsByCompany,
    getChannelsSortedByPriority,
    getHigherPriorityChannels,
    upsertChannel,
  };
}, { persist: true });
