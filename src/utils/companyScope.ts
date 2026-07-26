import { useWarehouseStore } from '../stores/warehouse';
import { useChannelStore } from '../stores/channel';

/** 过滤出属于指定主体的仓库 ID */
export function filterWarehouseIdsByCompany(warehouseIds: string[], companyId: string): string[] {
  const whStore = useWarehouseStore();
  return warehouseIds.filter(id => {
    const w = whStore.getWarehouseById(id);
    return !!w && w.companyId === companyId;
  });
}

/** 渠道可用仓库：仅同主体 */
export function getChannelAllowedWarehouses(channelId: string) {
  const channelStore = useChannelStore();
  const whStore = useWarehouseStore();
  const ch = channelStore.getChannelById(channelId);
  if (!ch) return [];
  return whStore
    .getWarehousesByIds(ch.warehouseIds)
    .filter(w => w.companyId === ch.companyId);
}

/** 校验：所选仓库必须全部属于该主体 */
export function assertWarehousesSameCompany(
  warehouseIds: string[],
  companyId: string,
): { ok: true } | { ok: false; message: string; invalidIds: string[] } {
  const whStore = useWarehouseStore();
  const invalid = warehouseIds.filter(id => {
    const w = whStore.getWarehouseById(id);
    return !w || w.companyId !== companyId;
  });
  if (invalid.length) {
    return {
      ok: false,
      message: '所选仓库必须与主体一致，不能跨主体要货',
      invalidIds: invalid,
    };
  }
  return { ok: true };
}

/** 校验：渠道与主体、仓库与主体一致 */
export function assertRequisitionScope(opts: {
  companyId: string;
  channelId: string;
  warehouseIds: string[];
}): { ok: true; warehouseIds: string[] } | { ok: false; message: string } {
  const channelStore = useChannelStore();
  const ch = channelStore.getChannelById(opts.channelId);
  if (!ch) return { ok: false, message: '渠道不存在' };
  if (ch.companyId !== opts.companyId) {
    return { ok: false, message: '渠道与主体不匹配，不能跨主体要货' };
  }
  const allowed = filterWarehouseIdsByCompany(opts.warehouseIds, opts.companyId);
  if (!opts.warehouseIds.length) {
    return { ok: false, message: '请选择仓库' };
  }
  if (allowed.length !== opts.warehouseIds.length) {
    return { ok: false, message: '存在跨主体仓库，已禁止混用。请只选本主体仓库' };
  }
  // 仓库还必须在渠道允许列表内
  const channelAllowed = new Set(getChannelAllowedWarehouses(opts.channelId).map(w => w.id));
  const notInChannel = allowed.filter(id => !channelAllowed.has(id));
  if (notInChannel.length) {
    return { ok: false, message: '所选仓库不在该渠道可用范围内（或非本主体）' };
  }
  return { ok: true, warehouseIds: allowed };
}
