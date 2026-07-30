import { useWarehouseStore } from '../stores/warehouse';
import { useChannelStore, channelBelongsToCompany, getChannelCompanyIds } from '../stores/channel';

/** 过滤出属于指定主体的仓库 ID */
export function filterWarehouseIdsByCompany(warehouseIds: string[], companyId: string): string[] {
  const whStore = useWarehouseStore();
  return warehouseIds.filter(id => {
    const w = whStore.getWarehouseById(id);
    return !!w && w.companyId === companyId;
  });
}

/**
 * 渠道可用仓库：严格取「渠道管理」里勾选的仓库。
 * 传入 companyId 时仅返回该主体下的绑定仓；不传则返回渠道全部绑定仓（支持多主体发货）。
 */
export function getChannelAllowedWarehouses(channelId: string, companyId?: string) {
  const channelStore = useChannelStore();
  const whStore = useWarehouseStore();
  const ch = channelStore.getChannelById(channelId);
  if (!ch) return [];
  const companyIds = getChannelCompanyIds(ch);
  if (!companyIds.length) return [];
  if (companyId && !companyIds.includes(companyId)) return [];

  const boundIds = Array.isArray(ch.warehouseIds) ? ch.warehouseIds : [];
  if (!boundIds.length) return [];

  const seen = new Set<string>();
  const result: ReturnType<typeof whStore.getWarehousesByCompany> = [];
  for (const ref of boundIds) {
    const id = String(ref || '').trim();
    if (!id || seen.has(id)) continue;
    let w = whStore.getWarehouseById(id);
    if (!w) {
      w =
        whStore.warehouses.find(x => x.code === id || x.name === id || x.id === id) || undefined;
    }
    if (!w) continue;
    if (companyId && w.companyId !== companyId) continue;
    if (!companyIds.includes(w.companyId)) continue;
    if (seen.has(w.id)) continue;
    seen.add(w.id);
    result.push(w);
  }
  return result;
}

/** 校验：所选仓库必须全部属于该主体（单次要货若需强制同主体时用） */
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

/**
 * 校验要货范围：
 * - 渠道须关联当前「开单主体」
 * - 仓库须在渠道绑定列表内（允许跨主体仓，支持多主体发货）
 */
export function assertRequisitionScope(opts: {
  companyId: string;
  channelId: string;
  warehouseIds: string[];
}): { ok: true; warehouseIds: string[] } | { ok: false; message: string } {
  const channelStore = useChannelStore();
  const ch = channelStore.getChannelById(opts.channelId);
  if (!ch) return { ok: false, message: '渠道不存在' };
  if (!channelBelongsToCompany(ch, opts.companyId)) {
    return { ok: false, message: '渠道未关联该主体，请先在渠道管理中绑定' };
  }
  if (!opts.warehouseIds.length) {
    return { ok: false, message: '请选择仓库' };
  }
  const channelAllowed = new Set(getChannelAllowedWarehouses(opts.channelId).map(w => w.id));
  const notInChannel = opts.warehouseIds.filter(id => !channelAllowed.has(id));
  if (notInChannel.length) {
    return { ok: false, message: '所选仓库不在该渠道绑定范围内' };
  }
  // 去重并保持顺序
  const seen = new Set<string>();
  const warehouseIds = opts.warehouseIds.filter(id => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return { ok: true, warehouseIds };
}
