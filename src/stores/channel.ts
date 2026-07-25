import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Channel } from '../types';

export const useChannelStore = defineStore('channel', () => {
  const channels = ref<Channel[]>([]);

  // 模拟初始数据
  const initChannels = () => {
    channels.value = [
      { id: 'C001', name: 'A渠道', warehouseIds: ['W001', 'W002', 'W003'], priority: 1, companyId: 'COMP001' },
      { id: 'C002', name: 'B渠道', warehouseIds: ['W001', 'W004'], priority: 2, companyId: 'COMP001' },
      { id: 'C003', name: 'C渠道', warehouseIds: ['W002', 'W003', 'W005'], priority: 3, companyId: 'COMP002' },
      { id: 'C004', name: 'D渠道', warehouseIds: ['W001', 'W002', 'W003', 'W004', 'W005'], priority: 10, companyId: 'COMP002' },
      { id: 'C005', name: 'E渠道', warehouseIds: ['W006', 'W007'], priority: 1, companyId: 'COMP003' },
      { id: 'C006', name: 'F渠道', warehouseIds: ['W006'], priority: 2, companyId: 'COMP004' },
    ];
  };

  const addChannel = (channel: Omit<Channel, 'id'>) => {
    const newChannel: Channel = {
      ...channel,
      id: Date.now().toString(),
      priority: channel.priority || 100,
    };
    channels.value.push(newChannel);
  };

  const updateChannel = (id: string, channel: Partial<Channel>) => {
    const index = channels.value.findIndex(c => c.id === id);
    if (index !== -1) {
      channels.value[index] = { ...channels.value[index], ...channel };
    }
  };

  const deleteChannel = (id: string) => {
    const index = channels.value.findIndex(c => c.id === id);
    if (index !== -1) {
      channels.value.splice(index, 1);
    }
  };

  const getChannelById = (id: string) => {
    return channels.value.find(c => c.id === id);
  };

  // 获取按优先级排序的渠道列表（数字越小优先级越高）
  const getChannelsSortedByPriority = () => {
    return [...channels.value].sort((a, b) => a.priority - b.priority);
  };

  // 获取比指定渠道优先级更高的渠道
  const getHigherPriorityChannels = (channelId: string) => {
    const currentChannel = getChannelById(channelId);
    if (!currentChannel) return [];
    return channels.value.filter(c => c.id !== channelId && c.priority < currentChannel.priority);
  };

  // 获取指定主体下的渠道列表
  const getChannelsByCompany = (companyId: string) => {
    return channels.value.filter(c => c.companyId === companyId);
  };

  return {
    channels,
    initChannels,
    addChannel,
    updateChannel,
    deleteChannel,
    getChannelById,
    getChannelsSortedByPriority,
    getHigherPriorityChannels,
    getChannelsByCompany,
  };
});