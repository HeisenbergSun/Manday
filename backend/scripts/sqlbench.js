const {Pool}=require('pg');require('dotenv').config({path:require('path').join(__dirname,'../.env')});
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
const BID='06e64698-abfb-4c21-b3ae-8fecd01ad8f2';
const q=`SELECT i.id, i.group_id, i.name, i.position, i.version, coalesce(jsonb_object_agg(iv.column_id, iv.value #>> '{}'), '{}'::jsonb) AS values FROM items i LEFT JOIN item_values iv ON iv.item_id = i.id WHERE i.board_id = $1 AND i.deleted_at IS NULL AND i.parent_item_id IS NULL GROUP BY i.id ORDER BY i.position`;
(async()=>{for(let k=0;k<4;k++){const t=Date.now();const r=await pool.query(q,[BID]);console.log('sql+fetch',Date.now()-t,'ms rows',r.rows.length,'bytes',JSON.stringify(r.rows).length)}await pool.end()})().catch(e=>console.error('ERR',e.message));
