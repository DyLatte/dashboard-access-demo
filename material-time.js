export const materialTimeVersion='2026-10-29-plan-added-1';
// Only the two verified aggregate sources are exempt. A stale flag must not
// hide an ordinary video's missing plan timestamp from coverage checks.
export const materialCountApplicable=row=>row.material_id!=='-2'&&!['roi2_live_material_analysis','site_promotion_post_data_live'].includes(row.source_fields?.dataset);
const key=(account,id)=>`${account}|${id}`;
const valid=time=>typeof time==='string'&&/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(time);

export function buildPlanTimeIndex(records) {
 const index=new Map();
 for(const record of records){
  if(!valid(record.plan_add_time))continue;
  const k=key(record.account_id,record.material_id),values=index.get(k)||[];
  values.push(record);index.set(k,values);
 }
 return index;
}
export function applyPlanTime(row,index) {
 if(!materialCountApplicable(row))return {...row,material_count_applicable:false,material_library_create_time:null,material_plan_add_time:null,material_create_time:null,material_time_basis:'aggregate_not_applicable',material_plan_time_candidates:[],material_plan_ids:[],material_time_version:materialTimeVersion};
 const records=index.get(key(row.account_id,row.material_id))||[];
 const times=[...new Set(records.map(r=>r.plan_add_time))].sort();
 // Multiple genuinely different plan times require an explicit business rule.
 // Do not silently substitute the library date or choose one plan arbitrarily.
 const added=times.length===1?times[0]:null;
 return {...row,
  material_count_applicable:true,
  material_library_create_time:row.material_library_create_time??(row.material_time_basis?null:row.material_create_time)??null,
  material_plan_add_time:added,material_create_time:added,
  material_time_basis:added?'plan_added':times.length>1?'multiple_plan_times':'plan_time_pending',
  material_plan_time_candidates:times,
  material_plan_ids:[...new Set(records.flatMap(r=>r.plan_ids||[]))],
  source_fields:{...row.source_fields,created:added?'roi2_material_upload_time':null,library_created:'material_create_time_v2',created_dataset:added?(records[0]?.source_dataset||'site_promotion_post_data_video'):'site_promotion_post_data_video'},
  material_time_version:materialTimeVersion
 };
}
export function materialAddedDate(row) {
 // Older rows without verified plan timestamps must not reuse library dates.
 const time=row.material_plan_add_time;
 return row.material_time_basis==='plan_added'&&valid(time)?time.slice(0,10):'';
}

// The registry uses videos already confirmed in the primary report history.
// It carries identity and plan time only, never performance from another day.
export function buildMaterialRegistry(rows,{through='9999-12-31'}={}) {
 const fields=['account_id','account_name','material_id','material_name','material_plan_add_time','material_time_basis','material_count_applicable','store','producer','product','video_type'];
 const registry=new Map();
 for(const row of rows){
  if(!materialCountApplicable(row)||row.source_fields?.dataset!=='site_promotion_post_data_video')continue;
  const added=materialAddedDate(row);
  if(added?added>through:row.date>through)continue;
  const id=key(row.account_id,row.material_id),old=registry.get(id);
  if(old&&old.last_observed_date>row.date){
   if(row.date<old.first_observed_date)old.first_observed_date=row.date;
   continue;
  }
  registry.set(id,{...Object.fromEntries(fields.filter(f=>row[f]!==undefined).map(f=>[f,row[f]])),
   source_fields:{dataset:row.source_fields.dataset},
   first_observed_date:old?.first_observed_date<row.date?old.first_observed_date:row.date,
   last_observed_date:row.date});
 }
 return [...registry.values()];
}
