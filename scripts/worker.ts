import {runWorker} from "../src/server/worker";
runWorker().catch(e=>{console.error(e);process.exitCode=1;});
