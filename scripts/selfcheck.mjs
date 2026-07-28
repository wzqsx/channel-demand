/**
 * 全量逻辑自检（不启浏览器）：主数据共享、主体隔离、完成率口径
 * 运行：node scripts/selfcheck.mjs
 */
import { createPinia, setActivePinia } from 'pinia';
import { createApp } from 'vue';

// 动态导入 store（依赖已激活的 pinia）
async function main() {
  const pinia = createPinia();
  setActivePinia(pinia);
  // 部分工具会间接依赖组件上下文，挂一个空 app 更稳
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
  const { completionRate } = await import('../src/utils/week.ts');

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
  const companyB = useCompanyStore(); // 同一 pinia 单例
  ok('公司种子已加载', companyA.companies.length >= 4, `len=${companyA.companies.length}`);
  ok('仓库/渠道/商品已加载',
    useWarehouseStore().warehouses.length > 0
      && useChannelStore().channels.length > 0
      && useProductStore().products.length > 0);

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
  wh.addWarehouse({ code: 'WH-SC', name: '自检仓', companyId: added.id });
  const newWh = wh.warehouses.find(w => w.code === 'WH-SC');
  ok('仓库挂到新主体', !!newWh && newWh.companyId === added.id);
  ok('按主体查仓可见', wh.getWarehousesByCompany(added.id).some(w => w.code === 'WH-SC'));

  const ch = useChannelStore();
  ch.addChannel({
    name: '自检渠道',
    companyId: added.id,
    warehouseIds: [newWh.id, 'W001'], // W001 属其他主体，应被过滤
    priority: 1,
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

  // 用旧主体渠道 + 新主体：应拒
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
  if (stock.stocks.length === 0) {
    stock.upsertStock(newWh.id, 'P001', 10, 5);
  } else {
    stock.upsertStock(newWh.id, 'P-SC', 10, 5);
  }
  const code = stock.stocks.find(s => s.warehouseId === newWh.id)?.productCode;
  const avail = stock.getAvailableStockByWarehouses(code, [newWh.id]);
  ok('可用库存 = 现货+在途（所选仓）', avail === 15, `avail=${avail}`);
  // 当前实现：空数组视为「不限制仓库」；业务侧应始终传入所选仓
  const availAll = stock.getAvailableStockByWarehouses(code, undefined);
  ok('不传仓库时按全库汇总', availAll >= avail);

  console.log('\n[7] 数量单位换算展示');
  const { formatQtyWithUnits } = await import('../src/utils/qtyDisplay.ts');
  ok('240瓶→10箱', formatQtyWithUnits(240, { bottlesPerBox: 24, boxUnit: '箱', bottleUnit: '瓶' }) === '10箱');
  ok('243瓶→10箱零3瓶', formatQtyWithUnits(243, { bottlesPerBox: 24, boxUnit: '箱', bottleUnit: '瓶' }) === '10箱零3瓶');
  ok('3瓶→3瓶', formatQtyWithUnits(3, { bottlesPerBox: 24, boxUnit: '箱', bottleUnit: '瓶' }) === '3瓶');
  ok('负243→负10箱零3瓶', formatQtyWithUnits(-243, { bottlesPerBox: 24, boxUnit: '箱', bottleUnit: '瓶' }) === '负10箱零3瓶');
  ok('负10→负10瓶', formatQtyWithUnits(-10, { bottlesPerBox: 24, boxUnit: '箱', bottleUnit: '瓶' }) === '负10瓶');
  ok('负240→负10箱', formatQtyWithUnits(-240, { bottlesPerBox: 24, boxUnit: '箱', bottleUnit: '瓶' }) === '负10箱');

  console.log('\n[8] 箱规库存折算进瓶规');
  const { getBottleEquivalentStock } = await import('../src/utils/packStock.ts');
  const stockStore = useWarehouseStockStore();
  // 固定仓：瓶规 10 + 箱规 2×12=24 → 可用 34
  stockStore.upsertStock('W001', 'P001', 10, 0);
  stockStore.upsertStock('W001', 'P0012', 2, 0);
  const eq = getBottleEquivalentStock('P001', ['W001']);
  ok('瓶规自身 10', eq.ownStock === 10, `own=${eq.ownStock}`);
  ok('箱规折算 24', eq.packStock === 24, `pack=${eq.packStock}`);
  ok('合计可用 34', eq.availableStock === 34, `avail=${eq.availableStock}`);

  console.log('\n[9] 要货 migrate 不炸');
  useRequisitionStore().migrateLegacy();
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
