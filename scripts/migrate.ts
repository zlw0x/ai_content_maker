import {readFile,readdir} from "node:fs/promises";
import path from "node:path";
import {db} from "../src/server/db";

async function main(){
  const pool=db();
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const list=(await readdir(path.join(process.cwd(),"database"))).filter(x=>/^\d+_.*\.sql$/.test(x)).sort();
  for(const name of list){
    const already=await pool.query("SELECT 1 FROM schema_migrations WHERE filename=$1",[name]);
    if(already.rowCount)continue;
    const sql=await readFile(path.join(process.cwd(),"database",name),"utf8");
    // Each migration SQL file has BEGIN/COMMIT, and CREATE IF NOT EXISTS.
    await pool.query(sql);
    await pool.query("INSERT INTO schema_migrations(filename) VALUES($1)",[name]);
    console.log("Applied migration:",name);
  }
  await pool.end();
}
main().catch(error=>{console.error(error);process.exitCode=1;});
