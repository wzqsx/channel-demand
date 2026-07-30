/**
 * 全量逻辑自检（不启浏览器）：主数据共享、主体隔离、完成率口径
 * 运行：npm run selfcheck
 */
import { createPinia, setActivePinia } from 'pinia';
import { createApp } from 'vue';

// Node 环境无 localStorage，给 persist / bootstrap 一个内存实现
if (typeof globalThis.localStorage === 'undefined') {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: k => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(String(k), String(v)),
    removeItem: k => mem.delete(k),
    clear: () => mem.clear(),
    key: i => [...mem.keys()][i] ?? null,
    get length() {
      return mem.size;
    },
  };
}

async function main() {
  const pinia = createPinia();
  setActivePinia(pinia);
  createApp({}).use(pinia);

  const { useCompanyStore } = await import('../src/stores/company.ts');
  const { useWarehouseStore } = await import('../src/stores/warehouse.ts');
  const { useChannelStore } = await import('../src/stores/channel.ts');
  const { useProductStore } = await import('../src/stores/product.ts');
  const { useWarehouseStockStore } = await import('../src/stores/warehouseStock.ts');
  const { useRequisitionStore } = await import('../src/stores/requisition.ts');
  const { bootstrapStores } = await import('../src/stores/bootstrap.ts');
  const {
    assertRequisitionScope,
    getChannelAllowedWarehouses,
  } = await import('../src/utils/companyScope.ts');
  const { completionRate, weekStartSaturday } = await import('../src/utils/week.ts');
  const { buildShortageAndWarnings } = await import('../src/utils/shortageAlert.ts');

  const fails = [];
  const ok = (name, cond, detail = '') => {
    if (cond) console.log(`  ✓ ${name}`);
    else {
      console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
      fails.push(name);
    }
  };

  console.log('\n[1] 启动初始化');
  bootstrapStores();
  const companyA = useCompanyStore();
  const companyB = useCompanyStore();
  ok('公司种子已加载', companyA.companies.length >= 4, `len=${companyA.companies.length}`);
  ok(
    '仓库/渠道/商品已加载',
    useWarehouseStore().warehouses.length > 0 &&
      useChannelStore().channels.length > 0 &&
      useProductStore().products.length > 0,
  );

  console.log('\n[2] 新增公司全局可见（多处读同一 store）');
  const before = companyA.companies.length;
  companyA.addCompany({ code: 'SELFCHK', name: '自检主体' });
  const added = companyA.companies.find(c => c.code === 'SELFCHK');
  ok('addCompany 写入成功', !!added);
  ok('另一处 useCompanyStore 立刻可见', companyB.companies.some(c => c.code === 'SELFCHK'));
  ok('数量 +1', companyB.companies.length === before + 1, `before=${before} after=${companyB.companies.length}`);
  ok('仓库页筛选：新主体仓库为空', useWarehouseStore().getWarehousesByCompany(added.id).length === 0);
  ok('渠道页筛选：新主体渠道为空', useChannelStore().getChannelsByCompany(added.id).length === 0);

  console.log('\n[3] 新主体挂仓/挂渠道后联动');
  const wh = useWarehouseStore();
  wh.addWarehouse({ code: '自检仓', name: '自检仓', companyId: added.id });
  const newWh = wh.warehouses.find(w => w.code === '自检仓' && w.companyId === added.id);
  ok('仓库挂到新主体', !!newWh && newWh.companyId === added.id);
  ok('按名称可解析仓库', !!wh.resolveWarehouse('自检仓'));

  const ch = useChannelStore();
  ch.addChannel({
    code: 'CH-SC',
    name: '自检渠道',
    companyId: added.id,
    warehouseIds: [newWh.id, 'W001'],
    priority: 1,
    enabled: true,
  });
  const newCh = ch.channels.find(c => c.name === '自检渠道' && c.companyId === added.id);
  ok('渠道创建时剥离跨主体仓库', !!newCh && newCh.warehouseIds.length === 1 && newCh.warehouseIds[0] === newWh.id);
  ok('渠道可用仓仅同主体', getChannelAllowedWarehouses(newCh.id).every(w => w.companyId === added.id));

  console.log('\n[4] 要货主体隔离');
  const bad = assertRequisitionScope({
    companyId: added.id,
    channelId: newCh.id,
    warehouseIds: [newWh.id, 'W001'],
  });
  ok('跨主体仓库要货被拒', bad.ok === false);
  const good = assertRequisitionScope({
    companyId: added.id,
    channelId: newCh.id,
    warehouseIds: [newWh.id],
  });
  ok('同主体要货通过', good.ok === true);

  const seedCh = ch.channels.find(c => c.companyId === 'COMP001');
  if (seedCh) {
    const cross = assertRequisitionScope({
      companyId: added.id,
      channelId: seedCh.id,
      warehouseIds: [newWh.id],
    });
    ok('渠道与主体不匹配被拒', cross.ok === false);
  }

  console.log('\n[5] 完成率口径 = 销货/要货（百分比，1位小数）');
  ok('完成率 50/100 = 50', completionRate(50, 100) === 50);
  ok('要货为 0 且有销货 → 100', completionRate(10, 0) === 100);
  ok('要货为 0 且无销货 → 0', completionRate(0, 0) === 0);
  ok('销货超出可 >100', completionRate(120, 100) === 120);

  console.log('\n[6] 库存可用量按所选仓库');
  const stock = useWarehouseStockStore();
  stock.initStocks();
  stock.upsertStock(newWh.id, 'P-SC', 10, 5);
  const avail = stock.getAvailableStockByWarehouses('P-SC', [newWh.id]);
  ok('可用库存 = 现货+在途（所选仓）', avail === 15, `avail=${avail}`);

  console.log('\n[7] 数量单位换算展示');
  const { formatQtyWithUnits, boxesToBottles } = await import('../src/utils/qtyDisplay.ts');
  ok('240瓶→10箱', formatQtyWithUnits(240, { bottlesPerBox: 24, boxUnit: '箱', bottleUnit: '瓶' }) === '10箱');
  ok('243瓶→10箱零3瓶', formatQtyWithUnits(243, { bottlesPerBox: 24, boxUnit: '箱', bottleUnit: '瓶' }) === '10箱零3瓶');
  ok('3瓶→3瓶', formatQtyWithUnits(3, { bottlesPerBox: 24, boxUnit: '箱', bottleUnit: '瓶' }) === '3瓶');
  ok('负243→负10箱零3瓶', formatQtyWithUnits(-243, { bottlesPerBox: 24, boxUnit: '箱', bottleUnit: '瓶' }) === '负10箱零3瓶');
  ok('5箱×24=120瓶', boxesToBottles(5, 24) === 120);

  console.log('\n[8] 箱规库存折算进瓶规');
  const { getBottleEquivalentStock } = await import('../src/utils/packStock.ts');
  const product = useProductStore();
  const pack = product.getProductByCode('P0012');
  ok(
    '组合品每箱瓶数=换算比例',
    !!pack && pack.bottlesPerBox === pack.combineRatio,
    `bpb=${pack?.bottlesPerBox} ratio=${pack?.combineRatio}`,
  );
  stock.upsertStock('W001', 'P001', 10, 0);
  stock.upsertStock('W001', 'P0012', 2, 0);
  const eq = getBottleEquivalentStock('P001', ['W001']);
  ok('瓶规自身 10', eq.ownStock === 10, `own=${eq.ownStock}`);
  ok('箱规折算 24', eq.packStock === 24, `pack=${eq.packStock}`);
  ok('合计可用 34', eq.availableStock === 34, `avail=${eq.availableStock}`);

  console.log('\n[9] 停用渠道不进缺货需求 + 高优含已通过');
  const week = weekStartSaturday();
  const req = useRequisitionStore();
  const hi = ch.channels.find(c => c.companyId === 'COMP001' && c.priority === 1);
  const lo = ch.channels.find(c => c.companyId === 'COMP001' && c.id !== hi?.id);
  ok('找到同主体高低优渠道', !!hi && !!lo);
  if (hi && lo) {
    ch.updateChannel(hi.id, { enabled: false });
    req.requisitions.push({
      id: 'SC-DIS',
      companyId: 'COMP001',
      channelId: hi.id,
      warehouseIds: ['W001'],
      weekStart: week,
      items: [{ id: '1', productCode: 'P001', productName: 'x', quantity: 9999, remark: '' }],
      status: 'approved',
      createdAt: new Date().toISOString(),
    });
    const rows = buildShortageAndWarnings({ weekStart: week, companyId: 'COMP001' });
    const hit = rows.find(r => r.productCode === 'P001' && r.totalDemand >= 9999);
    ok('停用渠道需求不进入缺货', !hit);

    ch.updateChannel(hi.id, { enabled: true });
    const higher = req.getHigherPriorityPendingDemand('P001', lo.id, ['W001']);
    ok('高优占用含已通过', higher >= 9999, `higher=${higher}`);
  }

  console.log('\n[10] 要货 migrate 不炸');
  req.migrateLegacy();
  ok('migrateLegacy 可执行', true);

  console.log('\n────────────────────');
  if (fails.length) {
    console.error(`自检失败 ${fails.length} 项:\n - ${fails.join('\n - ')}`);
    process.exit(1);
  }
  console.log('自检全部通过\n');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
